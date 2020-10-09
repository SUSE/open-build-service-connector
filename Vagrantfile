# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  config.vm.box = "opensuse/Tumbleweed.x86_64"
  config.vm.provision "shell", inline: <<-SHELL
    zypper --non-interactive ref
    zypper --non-interactive in npm nodejs git libsecret-devel libX11-devel libXcomposite1 libXcursor1 xvfb-run libXi6 libXtst6 mozilla-nss libatk-1_0-0 libatk-bridge-2_0-0 libXss1 libasound2 wget libgdk_pixbuf-2_0-0 libgtk-3-0
    npm install -g yarn
  SHELL
end
