#!/bin/sh

set -x

# Prep the test
cd pizza-demo
npm ci
cd ..

cd lib
npm ci
cd ..

npm ci

# run the test

npm run serve-and-test:parallel

npm run serve-and-test:parallel:some

npm run serve-and-test:parallel:spec

npm run serve-and-test:parallel:junit
