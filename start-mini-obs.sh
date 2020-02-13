#!/bin/bash

set -euo pipefail

export repo_dir="openSUSE-release-tools"
export subdir="dist/ci/"

pushd .

if [[ ! -d "${repo_dir}" ]]; then
  git clone https://github.com/openSUSE/${repo_dir}.git
  cp docker-compose.yml.patch ${repo_dir}/
fi

cd "${repo_dir}"
git pull origin master
git reset --hard master
patch -p1 < docker-compose.yml.patch

cd ${subdir}

docker-compose up &

# from openSUSE-release-tools/dist/ci/docker-compose-test.sh:
c=0
until curl http://localhost:8080/about 2>/dev/null ; do
  ((c++)) && ((c==500)) && (
    curl http://localhost:8080/about
    exit 1
  )
  sleep 1
done

popd
