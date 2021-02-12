#!/usr/bin/env node
/**
 * Copyright (c) 2020 SUSE LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

"use strict";

const keytar = require("keytar");
const assert = require("assert");
const fsPromises = require("fs").promises;
const { tmpdir } = require("os");
const { join } = require("path");

const SERVICE_NAME = "foo";

const ACC1 = "first";
const PW1 = `${ACC1}_pw`;

const ACC2 = "second";
const PW2 = `pw_${ACC2}`;

const FAIL_FILE = join(tmpdir(), "mocklibsecret_error_message");

const ensureFailFileGone = async () => {
  try {
    await fsPromises.unlink(FAIL_FILE);
  } catch (_err) {}
};

const successTest = async function () {
  await Promise.all(
    (await keytar.findCredentials(SERVICE_NAME)).map((cred) =>
      keytar.deletePassword(SERVICE_NAME, cred.account)
    )
  );

  const creds = await keytar.findCredentials(SERVICE_NAME);
  assert(creds.length === 0);

  await keytar.setPassword(SERVICE_NAME, ACC1, PW1);
  assert((await keytar.getPassword(SERVICE_NAME, ACC1)) === PW1);

  await keytar.setPassword(SERVICE_NAME, ACC2, PW2);
  assert((await keytar.getPassword(SERVICE_NAME, ACC2)) === PW2);
  assert((await keytar.getPassword(SERVICE_NAME, ACC1)) === PW1);

  let newCreds = await keytar.findCredentials(SERVICE_NAME);
  assert(newCreds.length === 2);

  assert(await keytar.deletePassword(SERVICE_NAME, ACC1));

  newCreds = await keytar.findCredentials(SERVICE_NAME);
  assert(newCreds.length === 1);
  assert(newCreds[0].account === ACC2);
  assert(newCreds[0].password === PW2);

  // this fails due to limitations of mocklibsecret
  // console.log(await keytar.findPassword(SERVICE_NAME));
};

const expectFailure = async (func, regex) => {
  let failed = true;
  try {
    await func();
    failed = false;
  } catch (err) {
    assert(err.toString().match(regex));
  }
  assert(failed);
};

const failInnerTest = async (err) => {
  await expectFailure(() => keytar.findCredentials(SERVICE_NAME), err);
  await expectFailure(() => keytar.setPassword(SERVICE_NAME, ACC1, PW1), err);
  await expectFailure(() => keytar.getPassword(SERVICE_NAME, ACC1), err);
  await expectFailure(() => keytar.deletePassword(SERVICE_NAME, ACC1), err);
};

const failTest = async function () {
  process.env.MOCKLIBSECRET_ERROR_MESSAGE = "TADA!";
  await ensureFailFileGone();
  const err = /tada/i;

  await failInnerTest(err);
};

const failViaFileTest = async function () {
  delete process.env.MOCKLIBSECRET_ERROR_MESSAGE;
  const err = "Libsecret call failed, scream and run around in panic!!";
  await fsPromises.writeFile(FAIL_FILE, err);

  await failInnerTest(err);
};

const failViaEmptyFileTest = async function () {
  delete process.env.MOCKLIBSECRET_ERROR_MESSAGE;
  const err = "libsecret call failed";
  await fsPromises.writeFile(FAIL_FILE, "");

  await failInnerTest(err);
};

(async () => {
  await successTest();
  await failTest();
  await failViaFileTest();
  await failViaEmptyFileTest();
})()
  .catch((err) => {
    console.error(`Test failed with: ${err}`);
    console.error(`${err.stack}`);
    process.exitCode = 1;
  })
  .finally(() => {
    delete process.env.MOCKLIBSECRET_ERROR_MESSAGE;
    return ensureFailFileGone();
  });
