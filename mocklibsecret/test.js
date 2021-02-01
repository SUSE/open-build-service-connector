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

const SERVICE_NAME = "foo";

(async function () {
  await Promise.all(
    (await keytar.findCredentials(SERVICE_NAME)).map((cred) =>
      keytar.deletePassword(SERVICE_NAME, cred.account)
    )
  );

  const creds = await keytar.findCredentials(SERVICE_NAME);
  assert(creds.length === 0);

  const acc1 = "first";
  const pw1 = `${acc1}_pw`;
  await keytar.setPassword(SERVICE_NAME, acc1, pw1);
  assert((await keytar.getPassword(SERVICE_NAME, acc1)) === pw1);

  const acc2 = "second";
  const pw2 = `pw_${acc2}`;
  await keytar.setPassword(SERVICE_NAME, acc2, pw2);
  assert((await keytar.getPassword(SERVICE_NAME, acc2)) === pw2);
  assert((await keytar.getPassword(SERVICE_NAME, acc1)) === pw1);

  let newCreds = await keytar.findCredentials(SERVICE_NAME);
  assert(newCreds.length === 2);

  assert(await keytar.deletePassword(SERVICE_NAME, acc1));

  newCreds = await keytar.findCredentials(SERVICE_NAME);
  assert(newCreds.length === 1);
  assert(newCreds[0].account === acc2);
  assert(newCreds[0].password === pw2);

  // this fails due to limitations of mocklibsecret
  // console.log(await keytar.findPassword(SERVICE_NAME));
})().catch((err) => {
  console.error(`Test failed with: ${err}`);
  process.exitCode = 1;
});
