#!/bin/bash

set -ox pipefail

rm logfile.json
node ./out/test/runTest.js
retval=$?
pino-pretty < logfile.json

exit $retval
