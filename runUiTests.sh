#!/bin/bash

set -euox pipefail

export EXTENSION_DEBUG=1

yarn run compile
yarn run mocklibsecret

for dir in $(ls -d src/ui-tests/*/); do
  testname=$(basename "${dir}")
  node ./out/ui-tests/runTests.js "${testname}"
done
