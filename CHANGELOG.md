# Changelog

All notable changes to "Open Build Service Connector" extension will be
documented in this file.

The format is based on [Keep a
Changelog](https://keepachangelog.com/en/1.0.0/).

## Unreleased

### Added


### Changed


### Removed


## [0.0.6] - 2021-03-11

### Added

- Log internal errors better and provide the user with a error reporting page
- Add command to the server entries to open the settings directly
- Add support to view the build status and build log

### Changed

- Revamp the creation of new accounts and improve handling of custom SSL
  certificates
- Packages and Projects are checked out into new subdirectories

### Removed


## [0.0.5] - 2020-10-22

### Added

- Support importing accounts with obfuscated passwords

### Changed

- Multiple internal fixes for Windows
- Improved performance with large packages

### Removed

## [0.0.4] - 2020-10-14

### Added

- Packages can be submitted via submit-requests

### Changed

- Button to branch a package is moved to the context menu
- Fixed multiple backend bugs involving branched packages

### Removed

## [0.0.3] - 2020-10-09

### Added

- Allow to run local builds via `osc build`
- Add new resource states for the source control
- Add command to branch and checkout a package
- New input form for project names

### Changed

- Make detection of the currently active project/package more robust
- The Project Tree Views allow for packages & projects that have been deleted
- Use bookmark codicon instead of EOS icon
- Make check for present accounts less brittle

### Removed

## [0.0.2] - 2020-06-17

### Added

- Repository paths can now be moved up and down in the Repositories view.

### Changed

- Fix not being able to add repositories to projects with no repositories
  defined.
- Checking out projects can now be cancelled.

### Removed

## [0.0.1] - 2020-06-03

First beta release of the Open Build Service Connector.
