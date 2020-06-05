#!/bin/bash

set -euox pipefail

yarn run compile
yarn run mockLibsecret

for dir in $(ls -d src/ui-tests/*/);do
  testname=$(basename "${dir}")
  node ./out/ui-tests/runTests.js "${testname}"
done
