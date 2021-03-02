#!/bin/bash

set -eox pipefail

yarn run mocklibsecret
export EXTENSION_DEBUG=1

rm -f logfile.json
mkdir -p test-home
export HOME="$(pwd)/test-home"
export LD_PRELOAD="$(pwd)/mocklibsecret/build/libsecret.so"
node ./out/test/runTest.js
