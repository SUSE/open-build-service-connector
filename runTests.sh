#!/bin/bash

set -ox pipefail

rm logfile.json
node ./out/test/runTest.js
retval=$?
cat logfile.json | pino-pretty

exit $retval
