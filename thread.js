const spawn = require('cross-spawn');
const { isYarn } = require('is-npm');
const path = require('path');
const fs = require('fs');
const camelCase = require('lodash.camelcase');
const globEscape = require('glob-escape');

const { settings } = require('./settings');
const { sleep } = require('./utility');

function getPackageManager() {
  const pckManager = isYarn
    ? 'yarn'
    : process.platform === 'win32'
    ? 'npm.cmd'
    : 'npm';

  return pckManager;
}

function createReporterOptions(string) {
  const options = string.split(',');
  return options.reduce((result, current) => {
    const parts = current.split('=');
    const optionName = parts[0].trim();
    const optionValue = parts[1].trim();
    result[optionName] = optionValue;

    return result;
  }, {});
}

function createReporterConfigFile(path) {
  const reporterEnabled = [
    '@openx/cypress-parallel-test-log/json-stream.reporter.js'
  ];
  let reporterName = settings.reporter;
  if (settings.reporter) {
    reporterEnabled.push(reporterName);
  } else {
    reporterEnabled.push(
      '@openx/cypress-parallel-test-log/simple-spec.reporter.js'
    );
  }
  const content = {
    reporterEnabled: reporterEnabled.join(', ')
  };

  if (settings.reporterOptions) {
    const optionName = `${camelCase(reporterName)}ReporterOptions`;
    content[optionName] = createReporterOptions(settings.reporterOptions);
  }
  content['runnerResults'] = settings.runnerResults;
  fs.writeFileSync(path, JSON.stringify(content, null, 2));
}

function createCommandArguments(thread) {
  const specFiles = `${thread.list.map((path) => globEscape(path)).join(',')}`;
  const childOptions = [
    'run',
    `${settings.script}`,
    isYarn ? '' : '--',
    '--spec',
    specFiles
  ];

  let reporterConfigPath;
  if (settings.reporterOptionsPath) {
    reporterConfigPath = settings.reporterOptionsPath;
  } else {
    reporterConfigPath = path.join(process.cwd(), 'multi-reporter-config.json');
    createReporterConfigFile(reporterConfigPath);
  }

  childOptions.push('--reporter', settings.reporterModulePath);
  childOptions.push('--reporter-options', `configFile=${reporterConfigPath}`);
  childOptions.push(...settings.scriptArguments);

  return childOptions;
}

async function executeThread(thread, index) {
  const packageManager = getPackageManager();
  const commandArguments = createCommandArguments(thread);
  const cypressThreadNumber = (index + 1).toString();
  const threadPrefix = `[${cypressThreadNumber}/${settings.threadCount}]`;

  // staggered start (when executed in container with xvfb ends up having a race condition causing intermittent failures)
  await sleep((index + 1) * 2000);

  const timeMap = new Map();

  const promise = new Promise((resolve, reject) => {
    const processOptions = {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: {
        ...process.env,
        CYPRESS_THREAD: cypressThreadNumber
      }
    };
    const child = spawn(packageManager, commandArguments, processOptions);

    let stdoutBuffer = '';

    child.stdout.on('data', function (chunk) {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      while (lines.length > 1) {
        const line = lines.shift();
        console.log(threadPrefix, line);
      }
      stdoutBuffer = lines.shift();
    });

    child.stdout.on('end', function () {
      console.log(threadPrefix, stdoutBuffer);
    });

    let stderrBuffer = '';

    child.stderr.on('data', function (chunk) {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      while (lines.length > 1) {
        const line = lines.shift();
        console.error(threadPrefix, line);
      }
      stderrBuffer = lines.shift();
    });

    child.stderr.on('end', function () {
      console.error(threadPrefix, stderrBuffer);
    });

    child.on('exit', (exitCode) => {
      if (settings.isVerbose) {
        console.log(
          `${threadPrefix} Thread likely finished with failure count: ${exitCode}`
        );
      }
      // should preferably exit earlier, but this is simple and better than nothing
      if (settings.shouldBail) {
        if (exitCode > 0) {
          console.error(
            `${threadPrefix} BAIL set and thread exited with errors, exit early with error`
          );
          process.exit(exitCode);
        }
      }
      resolve(timeMap);
    });
  });

  return promise;
}

module.exports = {
  executeThread
};
