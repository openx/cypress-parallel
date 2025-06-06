const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

const { settings } = require('./settings');
const { resultsPath } = require('./shared-config');

const getFilePathsByPath = (dir) =>
  fs.readdirSync(dir).reduce((files, file) => {
    const name = path.join(dir, file);
    const isDirectory = fs.statSync(name).isDirectory();
    if (isDirectory) return [...files, ...getFilePathsByPath(name)];
    return [...files, name];
  }, []);

async function getTestSuitePaths() {
  const isPattern = settings.testSuitesPath.includes('*');
  console.log(`Cleaning results path ${resultsPath}`);
  let fileList;
  if (settings.testSuitesPaths) {
    fileList = settings.testSuitesPaths;
  } else if (isPattern) {
    console.log(`Using pattern ${settings.testSuitesPath} to find test suites`);
    fileList = await glob(settings.testSuitesPath, {
      ignore: 'node_modules/**'
    });
  } else {
    console.log(
      'DEPRECATED: using path is deprecated and will be removed, switch to glob pattern'
    );
    fileList = getFilePathsByPath(settings.testSuitesPath);
  }

  console.log(`${fileList.length} test suite(s) found.`);
  if (settings.isVerbose) {
    console.log('Paths to found suites');
    console.log(JSON.stringify(fileList, null, 2));
  }

  // We can't run more threads than suites
  if (fileList.length < settings.threadCount) {
    console.log(
      `Thread setting is ${settings.threadCount}, but only ${fileList.length} test suite(s) were found. Adjusting configuration accordingly.`
    );
    settings.threadCount = fileList.length;
  }

  return fileList;
}

function getMaxPathLenghtFrom(testSuitePaths) {
  let maxLength = 10;

  for (let path of testSuitePaths) {
    maxLength = Math.max(maxLength, path.length);
  }

  return maxLength + 3;
}

function distributeTestsByWeight(testSuitePaths) {
  let specWeights = {};
  const weightPath = path.join(process.cwd(), settings.weightsJSON);
  try {
    specWeights = JSON.parse(fs.readFileSync(weightPath, 'utf8'));
  } catch (err) {
    console.log(`Weight file not found in path: ${weightPath}`);
  }

  let map = new Map();
  for (let f of testSuitePaths) {
    let specWeight = settings.defaultWeight;
    Object.keys(specWeights).forEach((spec) => {
      if (f.endsWith(spec)) {
        specWeight = specWeights[spec].weight;
      }
    });
    map.set(f, specWeight);
  }

  map = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));

  const threads = [];
  for (let i = 0; i < settings.threadCount; i++) {
    threads.push({
      weight: 0,
      list: []
    });
  }

  for (const [key, value] of map.entries()) {
    threads.sort((w1, w2) => w1.weight - w2.weight);
    threads[0].list.push(key);
    threads[0].weight += +value;
  }

  // Run slowest group first
  threads.sort((a, b) => b.weight - a.weight);

  return threads;
}

module.exports = {
  getTestSuitePaths,
  distributeTestsByWeight,
  getMaxPathLenghtFrom
};
