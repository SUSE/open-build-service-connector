#!/bin/bash

set -ox pipefail

yarn run mocklibsecret
export EXTENSION_DEBUG=1

rm logfile.json
mkdir -p test-home
export HOME="$(pwd)/test-home"
export LD_PRELOAD="$(pwd)/mocklibsecret/build/libsecret.so"
node ./out/test/runTest.js
retval=$?
pino-pretty < logfile.json

exit $retval
