#!/bin/bash

set -euo pipefail

export repo_dir="open-build-service"
export obs_url="http://localhost:3000"
obs_version=2.10.2

pushd .

if [[ ! -d "${repo_dir}" ]]; then
  git clone https://github.com/openSUSE/${repo_dir}.git
fi

cd "${repo_dir}"
git fetch origin master
git reset --hard ${obs_version}
git submodule init
git submodule update

rake docker:build
docker-compose up &

# from openSUSE-release-tools/dist/ci/docker-compose-test.sh:
c=0
until curl ${obs_url}/about 2>/dev/null ; do
  ((c++)) && ((c==500)) && (
    curl ${obs_url}/about
    exit 1
  )
  sleep 1
done

popd

TEST_USER="vscodeObsUser"
CREDENTIALS="Admin:opensuse"


# setup the user for the UI tests
curl --user ${CREDENTIALS} -X PUT ${obs_url}/person/${TEST_USER} -d "
<person>
<login>${TEST_USER}</login>
<email>vscodeObs@notexisting.com</email>
<state>confirmed</state>
</person>
"
curl --user ${CREDENTIALS} -X POST ${obs_url}/person/${TEST_USER}?cmd=change_password -d "nots3cr3t"

curl --user ${CREDENTIALS} -X PUT ${obs_url}/distributions -d '<distributions>
  <distribution vendor="openSUSE" version="Tumbleweed" id="13908">
    <name>openSUSE Tumbleweed</name>
    <project>openSUSE:Factory</project>
    <reponame>openSUSE_Tumbleweed</reponame>
    <repository>snapshot</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="15.2" id="13911">
    <name>openSUSE Leap 15.2</name>
    <project>openSUSE:Leap:15.2</project>
    <reponame>openSUSE_Leap_15.2</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="15.1" id="13914">
    <name>openSUSE Leap 15.1</name>
    <project>openSUSE:Leap:15.1</project>
    <reponame>openSUSE_Leap_15.1</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="15.1 ARM" id="13917">
    <name>openSUSE Leap 15.1 ARM</name>
    <project>openSUSE:Leap:15.1:ARM</project>
    <reponame>openSUSE_Leap_15.1_ARM</reponame>
    <repository>ports</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>aarch64</architecture>
    <architecture>armv7l</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="15.1 PowerPC" id="13920">
    <name>openSUSE Leap 15.1 PowerPC</name>
    <project>openSUSE:Leap:15.1:PowerPC</project>
    <reponame>openSUSE_Leap_15.1_PowerPC</reponame>
    <repository>ports</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="FactoryARM" id="13923">
    <name>openSUSE Factory ARM</name>
    <project>openSUSE:Factory:ARM</project>
    <reponame>openSUSE_Factory_ARM</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>armv7l</architecture>
    <architecture>aarch64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="PowerPC" id="13926">
    <name>openSUSE Factory PowerPC</name>
    <project>openSUSE:Factory:PowerPC</project>
    <reponame>openSUSE_Factory_PowerPC</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>ppc64</architecture>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="zSystems" id="13929">
    <name>openSUSE Factory zSystems</name>
    <project>openSUSE:Factory:zSystems</project>
    <reponame>openSUSE_Factory_zSystems</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>s390x</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_15_SP1_Backports" id="13932">
    <name>openSUSE Backports for SLE 15 SP1</name>
    <project>openSUSE:Backports:SLE-15-SP1</project>
    <reponame>SLE_15_SP1_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_15_Backports" id="13935">
    <name>openSUSE Backports for SLE 15</name>
    <project>openSUSE:Backports:SLE-15</project>
    <reponame>SLE_15_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12_SP5" id="13938">
    <name>openSUSE Backports for SLE 12 SP5</name>
    <project>openSUSE:Backports:SLE-12-SP5</project>
    <reponame>SLE_12_SP5_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12_SP4" id="13941">
    <name>openSUSE Backports for SLE 12 SP4</name>
    <project>openSUSE:Backports:SLE-12-SP4</project>
    <reponame>SLE_12_SP4_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12_SP3" id="13944">
    <name>openSUSE Backports for SLE 12 SP3</name>
    <project>openSUSE:Backports:SLE-12-SP3</project>
    <reponame>SLE_12_SP3_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12_SP2" id="13947">
    <name>openSUSE Backports for SLE 12 SP2</name>
    <project>openSUSE:Backports:SLE-12-SP2</project>
    <reponame>SLE_12_SP2_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12_SP1" id="13950">
    <name>openSUSE Backports for SLE 12 SP1</name>
    <project>openSUSE:Backports:SLE-12-SP1</project>
    <reponame>SLE_12_SP1_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="openSUSE" version="SLE_12" id="13953">
    <name>openSUSE Backports for SLE 12 SP0</name>
    <project>openSUSE:Backports:SLE-12</project>
    <reponame>SLE_12_Backports</reponame>
    <repository>standard</repository>
    <link>http://www.opensuse.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-15-SP1" id="13956">
    <name>SUSE SLE-15-SP1</name>
    <project>SUSE:SLE-15-SP1:GA</project>
    <reponame>SLE_15_SP1</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-15" id="13959">
    <name>SUSE SLE-15</name>
    <project>SUSE:SLE-15:GA</project>
    <reponame>SLE_15</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12-SP5" id="13962">
    <name>SUSE SLE-12-SP5</name>
    <project>SUSE:SLE-12-SP5:GA</project>
    <reponame>SLE_12_SP5</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12-SP4" id="13965">
    <name>SUSE SLE-12-SP4</name>
    <project>SUSE:SLE-12-SP4:GA</project>
    <reponame>SLE_12_SP4</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12-SP3" id="13968">
    <name>SUSE SLE-12-SP3</name>
    <project>SUSE:SLE-12-SP3:GA</project>
    <reponame>SLE_12_SP3</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12-SP2" id="13971">
    <name>SUSE SLE-12-SP2</name>
    <project>SUSE:SLE-12-SP2:GA</project>
    <reponame>SLE_12_SP2</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12-SP1" id="13974">
    <name>SUSE SLE-12-SP1</name>
    <project>SUSE:SLE-12-SP1:GA</project>
    <reponame>SLE_12_SP1</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-12" id="13977">
    <name>SUSE SLE-12</name>
    <project>SUSE:SLE-12:GA</project>
    <reponame>SLE_12</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-11-SP4" id="13980">
    <name>SUSE SLE-11 SP 4</name>
    <project>SUSE:SLE-11:SP4</project>
    <reponame>SLE_11_SP4</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="SUSE Linux Enterprise" version="SLE-10" id="13983">
    <name>SUSE SLE-10</name>
    <project>SUSE:SLE-10:SDK</project>
    <reponame>SLE_10_SDK</reponame>
    <repository>standard</repository>
    <link>http://www.suse.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/suse.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Arch" version="1.0" id="13986">
    <name>Arch Extra</name>
    <project>Arch:Extra</project>
    <reponame>Arch</reponame>
    <repository>standard</repository>
    <link>http://www.archlinux.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/arch.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/arch.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Arch" version="1.0" id="13989">
    <name>Arch Community</name>
    <project>Arch:Community</project>
    <reponame>Arch</reponame>
    <repository>standard</repository>
    <link>http://www.archlinux.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/arch.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/arch.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Raspbian" version="10" id="13992">
    <name>Raspbian 10</name>
    <project>Raspbian:10</project>
    <reponame>Raspbian_10</reponame>
    <repository>standard</repository>
    <link>http://www.raspbian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/raspbian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/raspbian.png" width="16" height="16"/>
    <architecture>armv7l</architecture>
  </distribution>
  <distribution vendor="Raspbian" version="9.0" id="13995">
    <name>Raspbian 9.0</name>
    <project>Raspbian:9.0</project>
    <reponame>Raspbian_9.0</reponame>
    <repository>standard</repository>
    <link>http://www.raspbian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/raspbian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/raspbian.png" width="16" height="16"/>
    <architecture>armv7l</architecture>
  </distribution>
  <distribution vendor="Debian" version="Unstable" id="13998">
    <name>Debian Unstable</name>
    <project>Debian:Next</project>
    <reponame>Debian_Unstable</reponame>
    <repository>standard</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Debian" version="Testing" id="14001">
    <name>Debian Testing</name>
    <project>Debian:Testing</project>
    <reponame>Debian_Testing</reponame>
    <repository>update</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Debian" version="10" id="14004">
    <name>Debian 10</name>
    <project>Debian:10</project>
    <reponame>Debian_10</reponame>
    <repository>standard</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Debian" version="9.0" id="14007">
    <name>Debian 9.0</name>
    <project>Debian:9.0</project>
    <reponame>Debian_9.0</reponame>
    <repository>standard</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Debian" version="8.0" id="14010">
    <name>Debian 8.0</name>
    <project>Debian:8.0</project>
    <reponame>Debian_8.0</reponame>
    <repository>standard</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Debian" version="7.0" id="14013">
    <name>Debian 7.0</name>
    <project>Debian:7.0</project>
    <reponame>Debian_7.0</reponame>
    <repository>standard</repository>
    <link>http://www.debian.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/debian.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Fedora" version="Rawhide" id="14016">
    <name>Fedora Rawhide (unstable)</name>
    <project>Fedora:Rawhide</project>
    <reponame>Fedora_Rawhide</reponame>
    <repository>standard</repository>
    <link>http://fedoraproject.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Fedora" version="31" id="14019">
    <name>Fedora 31</name>
    <project>Fedora:31</project>
    <reponame>Fedora_31</reponame>
    <repository>standard</repository>
    <link>http://fedoraproject.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
    <architecture>armv7l</architecture>
    <architecture>aarch64</architecture>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="Fedora" version="30" id="14022">
    <name>Fedora 30</name>
    <project>Fedora:30</project>
    <reponame>Fedora_30</reponame>
    <repository>standard</repository>
    <link>http://fedoraproject.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
    <architecture>i586</architecture>
    <architecture>armv7l</architecture>
    <architecture>aarch64</architecture>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="Fedora" version="29" id="14025">
    <name>Fedora 29</name>
    <project>Fedora:29</project>
    <reponame>Fedora_29</reponame>
    <repository>standard</repository>
    <link>http://fedoraproject.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/fedora.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
    <architecture>i586</architecture>
    <architecture>armv7l</architecture>
    <architecture>aarch64</architecture>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="ScientificLinux" version="SL-7" id="14028">
    <name>ScientificLinux 7</name>
    <project>ScientificLinux:7</project>
    <reponame>ScientificLinux_7</reponame>
    <repository>standard</repository>
    <link>http://www.ScientificLinux.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/scientificlinux.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/scientificlinux.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="ScientificLinux" version="SL-6" id="14031">
    <name>ScientificLinux 6</name>
    <project>ScientificLinux:6</project>
    <reponame>ScientificLinux_6</reponame>
    <repository>standard</repository>
    <link>http://www.ScientificLinux.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/scientificlinux.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/scientificlinux.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="RedHat" version="RHEL-7" id="14034">
    <name>RedHat RHEL-7</name>
    <project>RedHat:RHEL-7</project>
    <reponame>RHEL_7</reponame>
    <repository>standard</repository>
    <link>http://www.redhat.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
    <architecture>ppc64</architecture>
  </distribution>
  <distribution vendor="RedHat" version="RHEL-6" id="14037">
    <name>RedHat RHEL-6</name>
    <project>RedHat:RHEL-6</project>
    <reponame>RHEL_6</reponame>
    <repository>standard</repository>
    <link>http://www.redhat.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="RedHat" version="RHEL-5" id="14040">
    <name>RedHat RHEL-5</name>
    <project>RedHat:RHEL-5</project>
    <reponame>RHEL_5</reponame>
    <repository>standard</repository>
    <link>http://www.redhat.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/redhat.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="CentOS" version="CentOS-8-Stream" id="14043">
    <name>CentOS CentOS-8-Stream</name>
    <project>CentOS:CentOS-8:Stream</project>
    <reponame>CentOS_8_Stream</reponame>
    <repository>standard</repository>
    <link>http://www.centos.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="CentOS" version="CentOS-8" id="14046">
    <name>CentOS CentOS-8</name>
    <project>CentOS:CentOS-8</project>
    <reponame>CentOS_8</reponame>
    <repository>standard</repository>
    <link>http://www.centos.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="CentOS" version="CentOS-7" id="14049">
    <name>CentOS CentOS-7</name>
    <project>CentOS:CentOS-7</project>
    <reponame>CentOS_7</reponame>
    <repository>standard</repository>
    <link>http://www.centos.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="CentOS" version="CentOS-6" id="14052">
    <name>CentOS CentOS-6</name>
    <project>CentOS:CentOS-6</project>
    <reponame>CentOS_6</reponame>
    <repository>standard</repository>
    <link>http://www.centos.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/centos.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Ubuntu" version="19.10" id="14055">
    <name>Ubuntu 19.10</name>
    <project>Ubuntu:19.10</project>
    <reponame>xUbuntu_19.10</reponame>
    <repository>universe</repository>
    <link>http://www.ubuntu.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Ubuntu" version="19.04" id="14058">
    <name>Ubuntu 19.04</name>
    <project>Ubuntu:19.04</project>
    <reponame>xUbuntu_19.04</reponame>
    <repository>universe</repository>
    <link>http://www.ubuntu.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Ubuntu" version="18.04" id="14061">
    <name>Ubuntu 18.04</name>
    <project>Ubuntu:18.04</project>
    <reponame>xUbuntu_18.04</reponame>
    <repository>universe</repository>
    <link>http://www.ubuntu.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Ubuntu" version="16.04" id="14064">
    <name>Ubuntu 16.04</name>
    <project>Ubuntu:16.04</project>
    <reponame>xUbuntu_16.04</reponame>
    <repository>universe</repository>
    <link>http://www.ubuntu.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Ubuntu" version="14.04" id="14067">
    <name>Ubuntu 14.04</name>
    <project>Ubuntu:14.04</project>
    <reponame>xUbuntu_14.04</reponame>
    <repository>standard</repository>
    <link>http://www.ubuntu.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/ubuntu.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="4.4" id="14070">
    <name>Univention UCS 4.4</name>
    <project>Univention:4.4</project>
    <reponame>Univention_4.4</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="4.3" id="14073">
    <name>Univention UCS 4.3</name>
    <project>Univention:4.3</project>
    <reponame>Univention_4.3</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="4.2" id="14076">
    <name>Univention UCS 4.2</name>
    <project>Univention:4.2</project>
    <reponame>Univention_4.2</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="4.1" id="14079">
    <name>Univention UCS 4.1</name>
    <project>Univention:4.1</project>
    <reponame>Univention_4.1</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="4.0" id="14082">
    <name>Univention UCS 4.0</name>
    <project>Univention:4.0</project>
    <reponame>Univention_4.0</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Mageia" version="Cauldron" id="14085">
    <name>Mageia Cauldron (unstable)</name>
    <project>Mageia:Cauldron</project>
    <reponame>Mageia_Cauldron</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Mageia" version="7" id="14088">
    <name>Mageia 7</name>
    <project>Mageia:7</project>
    <reponame>Mageia_7</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="16" height="16"/>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Mageia" version="6" id="14091">
    <name>Mageia 6</name>
    <project>Mageia:6</project>
    <reponame>Mageia_6</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/mageia.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="Univention" version="3.2" id="14094">
    <name>Univention UCS 3.2</name>
    <project>Univention:3.2</project>
    <reponame>Univention_3.2</reponame>
    <repository>standard</repository>
    <link>http://www.univention.com/</link>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/univention.png" width="16" height="16"/>
    <architecture>i586</architecture>
    <architecture>x86_64</architecture>
  </distribution>
  <distribution vendor="IBM" version="3.1" id="14097">
    <name>IBM PowerKVM 3.1</name>
    <project>IBM:PowerKVM:3.1</project>
    <reponame>PowerKVM_3.1</reponame>
    <repository>standard</repository>
    <link>http://www-03.ibm.com/systems/power/software/linux/powerkvm/</link>
    <icon url="https://static.opensuse.org/distributions/logos/powerkvm.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/powerkvm.png" width="16" height="16"/>
    <architecture>ppc64le</architecture>
  </distribution>
  <distribution vendor="Many" version="42.3" id="14100">
    <name>AppImage</name>
    <project>OBS:AppImage</project>
    <reponame>AppImage</reponame>
    <repository>AppImage</repository>
    <link>http://www.appimage.org/</link>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="8" height="8"/>
    <icon url="https://static.opensuse.org/distributions/logos/opensuse.png" width="16" height="16"/>
  </distribution>
</distributions>
'
