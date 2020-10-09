#!/bin/bash

set -ox pipefail

rm logfile.json
node ./out/test/runTest.js
retval=$?
if [[ "$1" != "--quiet" ]]; then
  pino-pretty < logfile.json
fi

exit $retval
