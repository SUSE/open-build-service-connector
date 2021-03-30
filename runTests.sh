#!/bin/bash

set -eox pipefail

yarn run mocklibsecret
export EXTENSION_DEBUG=1

mkdir -p test-home
mkdir -p test-tmp
export TMPDIR="$(pwd)/test-tmp"
export HOME="$(pwd)/test-home"
export LD_PRELOAD="$(pwd)/mocklibsecret/build/libsecret.so"
node ./out/test/runTest.js
