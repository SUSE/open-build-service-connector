#!/usr/bin/node

"use strict";

const keytar = require("keytar");
const assert = require("assert");

let result = (async function() {
  const pw = await keytar.getPassword("foo", "bar");
  assert(
    process.env.MOCK_SECRET_PASSWORD_LOOKUP === undefined
      ? pw === ""
      : pw === process.env.MOCK_SECRET_PASSWORD_LOOKUP
  );

  const deleteSuccess = await keytar.deletePassword("foo", "bar");
  assert(
    deleteSuccess ===
      (process.env.MOCK_SECRET_PASSWORD_CLEAR_RETVAL === undefined
        ? true
        : process.env.MOCK_SECRET_PASSWORD_CLEAR_RETVAL === "1")
  );

  await keytar.setPassword("foo", "bar", "baz");
})().catch(err => {
  console.error(`Test failed with: ${err}`);
  process.exitCode = 1;
});
