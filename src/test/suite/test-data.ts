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

import { Connection } from "obs-ts";
import { AccountStorage, ValidAccount } from "../../accounts";

export const fakeAccount1: AccountStorage = {
  accountName: "foo",
  apiUrl: "https://api.baz.org/",
  username: "fooUser"
};

export const fakeAccount2: AccountStorage = {
  accountName: "bar",
  apiUrl: "https://api.obs.xyz/",
  username: "barUser"
};

export const fakeApi1ValidAcc: ValidAccount = {
  account: fakeAccount1,
  connection: new Connection(
    fakeAccount1.username,
    fakeAccount1.username,
    fakeAccount1.apiUrl
  )
};

export const fakeApi2ValidAcc: ValidAccount = {
  account: fakeAccount2,
  connection: new Connection(
    fakeAccount2.username,
    fakeAccount2.username,
    fakeAccount2.apiUrl
  )
};
