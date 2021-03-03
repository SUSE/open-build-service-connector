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

import {
  Connection,
  ConnectionState,
  Package,
  PackageFile,
  Project
} from "open-build-service-api";
import { AccountStorage, ValidAccount } from "../../accounts";

export const fakeAccount1: AccountStorage = Object.freeze({
  accountName: "foo",
  apiUrl: "https://api.baz.org/",
  username: "fooUser"
});

export const fakeAccount2: AccountStorage = Object.freeze({
  accountName: "bar",
  apiUrl: "https://api.obs.xyz/",
  username: "barUser"
});

const state = ConnectionState.Ok;

export const fakeApi1ValidAcc: ValidAccount = Object.freeze({
  account: fakeAccount1,
  connection: new Connection(fakeAccount1.username, fakeAccount1.username, {
    url: fakeAccount1.apiUrl
  }),
  state
});

export const fakeApi2ValidAcc: ValidAccount = Object.freeze({
  account: fakeAccount2,
  connection: new Connection(fakeAccount2.username, fakeAccount2.username, {
    url: fakeAccount2.apiUrl
  }),
  state
});

export const fooProj: Project = {
  apiUrl: fakeAccount1.apiUrl,
  name: "fooProj"
};

export const barProj: Project = {
  apiUrl: fakeAccount1.apiUrl,
  name: "barProj"
};

export const bazProj: Project = {
  apiUrl: fakeAccount2.apiUrl,
  name: "bazProj"
};

export const fooPkg: Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "fooPkg",
  projectName: fooProj.name
};
export const foo2Pkg: Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "foo2Pkg",
  projectName: fooProj.name
};
export const packages = [fooPkg, foo2Pkg];

export const fooProjWithPackages: Project = {
  ...fooProj,
  packages
};

export const barPkg: Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "barPkg",
  projectName: barProj.name
};

export const [fileA, fileB]: PackageFile[] = ["fileA", "fileB"].map((name) => ({
  name,
  packageName: barPkg.name,
  projectName: barPkg.projectName
}));

export const barPkgWithFiles: Package = {
  ...barPkg,
  files: [fileA, fileB]
};

export const barProjWithPackages: Project = {
  ...barProj,
  packages: [barPkgWithFiles]
};

export const barProjWithPackagesWithoutFiles: Project = {
  ...barProj,
  packages: [barPkg]
};

export const CA_CERT_ROOT_CERTIFICATE_RAW = Buffer.from([
  48,
  130,
  6,
  238,
  48,
  130,
  4,
  214,
  160,
  3,
  2,
  1,
  2,
  2,
  1,
  15,
  48,
  13,
  6,
  9,
  42,
  134,
  72,
  134,
  247,
  13,
  1,
  1,
  11,
  5,
  0,
  48,
  121,
  49,
  16,
  48,
  14,
  6,
  3,
  85,
  4,
  10,
  19,
  7,
  82,
  111,
  111,
  116,
  32,
  67,
  65,
  49,
  30,
  48,
  28,
  6,
  3,
  85,
  4,
  11,
  19,
  21,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  119,
  119,
  119,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  49,
  34,
  48,
  32,
  6,
  3,
  85,
  4,
  3,
  19,
  25,
  67,
  65,
  32,
  67,
  101,
  114,
  116,
  32,
  83,
  105,
  103,
  110,
  105,
  110,
  103,
  32,
  65,
  117,
  116,
  104,
  111,
  114,
  105,
  116,
  121,
  49,
  33,
  48,
  31,
  6,
  9,
  42,
  134,
  72,
  134,
  247,
  13,
  1,
  9,
  1,
  22,
  18,
  115,
  117,
  112,
  112,
  111,
  114,
  116,
  64,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  48,
  30,
  23,
  13,
  48,
  51,
  48,
  51,
  51,
  48,
  49,
  50,
  50,
  57,
  52,
  57,
  90,
  23,
  13,
  51,
  51,
  48,
  51,
  50,
  57,
  49,
  50,
  50,
  57,
  52,
  57,
  90,
  48,
  121,
  49,
  16,
  48,
  14,
  6,
  3,
  85,
  4,
  10,
  19,
  7,
  82,
  111,
  111,
  116,
  32,
  67,
  65,
  49,
  30,
  48,
  28,
  6,
  3,
  85,
  4,
  11,
  19,
  21,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  119,
  119,
  119,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  49,
  34,
  48,
  32,
  6,
  3,
  85,
  4,
  3,
  19,
  25,
  67,
  65,
  32,
  67,
  101,
  114,
  116,
  32,
  83,
  105,
  103,
  110,
  105,
  110,
  103,
  32,
  65,
  117,
  116,
  104,
  111,
  114,
  105,
  116,
  121,
  49,
  33,
  48,
  31,
  6,
  9,
  42,
  134,
  72,
  134,
  247,
  13,
  1,
  9,
  1,
  22,
  18,
  115,
  117,
  112,
  112,
  111,
  114,
  116,
  64,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  48,
  130,
  2,
  34,
  48,
  13,
  6,
  9,
  42,
  134,
  72,
  134,
  247,
  13,
  1,
  1,
  1,
  5,
  0,
  3,
  130,
  2,
  15,
  0,
  48,
  130,
  2,
  10,
  2,
  130,
  2,
  1,
  0,
  206,
  34,
  192,
  226,
  70,
  125,
  236,
  54,
  40,
  7,
  80,
  150,
  242,
  160,
  51,
  64,
  140,
  75,
  241,
  59,
  102,
  63,
  49,
  229,
  107,
  2,
  54,
  219,
  214,
  124,
  246,
  241,
  136,
  143,
  78,
  119,
  54,
  5,
  65,
  149,
  249,
  9,
  240,
  18,
  207,
  70,
  134,
  115,
  96,
  183,
  110,
  126,
  232,
  192,
  88,
  100,
  174,
  205,
  176,
  173,
  69,
  23,
  12,
  99,
  250,
  103,
  10,
  232,
  214,
  210,
  191,
  62,
  231,
  152,
  196,
  240,
  76,
  250,
  224,
  3,
  187,
  53,
  93,
  108,
  33,
  222,
  158,
  32,
  217,
  186,
  205,
  102,
  50,
  55,
  114,
  250,
  247,
  8,
  245,
  199,
  205,
  88,
  201,
  142,
  231,
  14,
  94,
  234,
  62,
  254,
  28,
  161,
  20,
  10,
  21,
  108,
  134,
  132,
  91,
  100,
  102,
  42,
  122,
  169,
  75,
  83,
  121,
  245,
  136,
  162,
  123,
  238,
  47,
  10,
  97,
  43,
  141,
  178,
  126,
  77,
  86,
  165,
  19,
  236,
  234,
  218,
  146,
  158,
  172,
  68,
  65,
  30,
  88,
  96,
  101,
  5,
  102,
  248,
  192,
  68,
  189,
  203,
  148,
  247,
  66,
  126,
  11,
  247,
  101,
  104,
  152,
  81,
  5,
  240,
  243,
  5,
  145,
  4,
  29,
  27,
  23,
  130,
  236,
  200,
  87,
  187,
  195,
  107,
  122,
  136,
  241,
  176,
  114,
  204,
  37,
  91,
  32,
  145,
  236,
  22,
  2,
  18,
  143,
  50,
  233,
  23,
  24,
  72,
  208,
  199,
  5,
  46,
  2,
  48,
  66,
  184,
  37,
  156,
  5,
  107,
  63,
  170,
  58,
  167,
  235,
  83,
  72,
  247,
  232,
  210,
  182,
  7,
  152,
  220,
  27,
  198,
  52,
  127,
  127,
  201,
  28,
  130,
  122,
  5,
  88,
  43,
  8,
  91,
  243,
  56,
  162,
  171,
  23,
  93,
  102,
  201,
  152,
  215,
  158,
  16,
  139,
  162,
  210,
  221,
  116,
  154,
  247,
  113,
  12,
  114,
  96,
  223,
  205,
  111,
  152,
  51,
  157,
  150,
  52,
  118,
  62,
  36,
  122,
  146,
  176,
  14,
  149,
  30,
  111,
  230,
  160,
  69,
  56,
  71,
  170,
  215,
  65,
  237,
  74,
  183,
  18,
  246,
  215,
  27,
  131,
  138,
  15,
  46,
  216,
  9,
  182,
  89,
  215,
  170,
  4,
  255,
  210,
  147,
  125,
  104,
  46,
  221,
  139,
  75,
  171,
  88,
  186,
  47,
  141,
  234,
  149,
  167,
  160,
  195,
  84,
  137,
  165,
  251,
  219,
  139,
  81,
  34,
  157,
  178,
  195,
  190,
  17,
  190,
  44,
  145,
  134,
  139,
  150,
  120,
  173,
  32,
  211,
  138,
  47,
  26,
  63,
  198,
  208,
  81,
  101,
  135,
  33,
  177,
  25,
  1,
  101,
  127,
  69,
  28,
  135,
  245,
  124,
  208,
  65,
  76,
  79,
  41,
  152,
  33,
  253,
  51,
  31,
  117,
  12,
  4,
  81,
  250,
  25,
  119,
  219,
  212,
  20,
  28,
  238,
  129,
  195,
  29,
  245,
  152,
  183,
  105,
  6,
  145,
  34,
  221,
  0,
  80,
  204,
  129,
  49,
  172,
  18,
  7,
  123,
  56,
  218,
  104,
  91,
  230,
  43,
  212,
  126,
  201,
  95,
  173,
  232,
  235,
  114,
  76,
  243,
  1,
  229,
  75,
  32,
  191,
  154,
  166,
  87,
  202,
  145,
  0,
  1,
  139,
  161,
  117,
  33,
  55,
  181,
  99,
  13,
  103,
  62,
  70,
  79,
  112,
  32,
  103,
  206,
  197,
  214,
  89,
  219,
  2,
  224,
  240,
  210,
  203,
  205,
  186,
  98,
  183,
  144,
  65,
  232,
  221,
  32,
  228,
  41,
  188,
  100,
  41,
  66,
  200,
  34,
  220,
  120,
  154,
  255,
  67,
  236,
  152,
  27,
  9,
  81,
  75,
  90,
  90,
  194,
  113,
  241,
  196,
  203,
  115,
  169,
  229,
  161,
  11,
  2,
  3,
  1,
  0,
  1,
  163,
  130,
  1,
  127,
  48,
  130,
  1,
  123,
  48,
  29,
  6,
  3,
  85,
  29,
  14,
  4,
  22,
  4,
  20,
  22,
  181,
  50,
  27,
  212,
  199,
  243,
  224,
  230,
  142,
  243,
  189,
  210,
  176,
  58,
  238,
  178,
  57,
  24,
  209,
  48,
  15,
  6,
  3,
  85,
  29,
  19,
  1,
  1,
  255,
  4,
  5,
  48,
  3,
  1,
  1,
  255,
  48,
  52,
  6,
  9,
  96,
  134,
  72,
  1,
  134,
  248,
  66,
  1,
  8,
  4,
  39,
  22,
  37,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  119,
  119,
  119,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  47,
  105,
  110,
  100,
  101,
  120,
  46,
  112,
  104,
  112,
  63,
  105,
  100,
  61,
  49,
  48,
  48,
  86,
  6,
  9,
  96,
  134,
  72,
  1,
  134,
  248,
  66,
  1,
  13,
  4,
  73,
  22,
  71,
  84,
  111,
  32,
  103,
  101,
  116,
  32,
  121,
  111,
  117,
  114,
  32,
  111,
  119,
  110,
  32,
  99,
  101,
  114,
  116,
  105,
  102,
  105,
  99,
  97,
  116,
  101,
  32,
  102,
  111,
  114,
  32,
  70,
  82,
  69,
  69,
  32,
  104,
  101,
  97,
  100,
  32,
  111,
  118,
  101,
  114,
  32,
  116,
  111,
  32,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  119,
  119,
  119,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  48,
  49,
  6,
  3,
  85,
  29,
  31,
  4,
  42,
  48,
  40,
  48,
  38,
  160,
  36,
  160,
  34,
  134,
  32,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  99,
  114,
  108,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  47,
  114,
  101,
  118,
  111,
  107,
  101,
  46,
  99,
  114,
  108,
  48,
  51,
  6,
  9,
  96,
  134,
  72,
  1,
  134,
  248,
  66,
  1,
  4,
  4,
  38,
  22,
  36,
  85,
  82,
  73,
  58,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  99,
  114,
  108,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  47,
  114,
  101,
  118,
  111,
  107,
  101,
  46,
  99,
  114,
  108,
  48,
  50,
  6,
  8,
  43,
  6,
  1,
  5,
  5,
  7,
  1,
  1,
  4,
  38,
  48,
  36,
  48,
  34,
  6,
  8,
  43,
  6,
  1,
  5,
  5,
  7,
  48,
  1,
  134,
  22,
  104,
  116,
  116,
  112,
  58,
  47,
  47,
  111,
  99,
  115,
  112,
  46,
  99,
  97,
  99,
  101,
  114,
  116,
  46,
  111,
  114,
  103,
  48,
  31,
  6,
  3,
  85,
  29,
  35,
  4,
  24,
  48,
  22,
  128,
  20,
  22,
  181,
  50,
  27,
  212,
  199,
  243,
  224,
  230,
  142,
  243,
  189,
  210,
  176,
  58,
  238,
  178,
  57,
  24,
  209,
  48,
  13,
  6,
  9,
  42,
  134,
  72,
  134,
  247,
  13,
  1,
  1,
  11,
  5,
  0,
  3,
  130,
  2,
  1,
  0,
  71,
  156,
  215,
  179,
  162,
  23,
  211,
  82,
  83,
  183,
  180,
  106,
  221,
  191,
  155,
  53,
  21,
  33,
  108,
  239,
  111,
  24,
  19,
  32,
  129,
  204,
  232,
  237,
  29,
  42,
  34,
  29,
  100,
  118,
  20,
  186,
  91,
  55,
  43,
  14,
  131,
  186,
  62,
  74,
  110,
  70,
  13,
  11,
  222,
  163,
  59,
  97,
  0,
  122,
  167,
  13,
  149,
  250,
  230,
  243,
  23,
  188,
  101,
  224,
  45,
  7,
  90,
  91,
  95,
  204,
  244,
  219,
  204,
  1,
  221,
  38,
  216,
  218,
  37,
  12,
  59,
  65,
  160,
  101,
  152,
  6,
  41,
  55,
  96,
  139,
  7,
  162,
  94,
  131,
  202,
  191,
  213,
  122,
  96,
  119,
  15,
  254,
  32,
  253,
  70,
  71,
  7,
  96,
  239,
  21,
  41,
  69,
  229,
  0,
  227,
  205,
  165,
  224,
  193,
  245,
  145,
  253,
  22,
  209,
  167,
  125,
  225,
  43,
  136,
  124,
  213,
  144,
  29,
  199,
  75,
  2,
  153,
  167,
  163,
  244,
  148,
  135,
  86,
  233,
  103,
  39,
  150,
  172,
  201,
  229,
  134,
  65,
  141,
  12,
  163,
  49,
  8,
  36,
  23,
  67,
  126,
  180,
  79,
  1,
  71,
  115,
  199,
  95,
  16,
  6,
  170,
  230,
  188,
  186,
  113,
  156,
  230,
  214,
  135,
  173,
  174,
  68,
  175,
  136,
  77,
  170,
  161,
  252,
  111,
  191,
  85,
  69,
  137,
  15,
  189,
  77,
  125,
  255,
  206,
  65,
  2,
  10,
  197,
  1,
  252,
  72,
  207,
  51,
  73,
  113,
  20,
  25,
  174,
  245,
  62,
  72,
  135,
  225,
  42,
  158,
  207,
  98,
  190,
  106,
  196,
  33,
  0,
  239,
  246,
  211,
  114,
  36,
  123,
  139,
  176,
  51,
  106,
  109,
  64,
  90,
  151,
  179,
  168,
  136,
  246,
  103,
  94,
  79,
  75,
  31,
  234,
  155,
  250,
  146,
  223,
  214,
  135,
  239,
  230,
  122,
  50,
  230,
  245,
  246,
  107,
  147,
  138,
  121,
  177,
  222,
  251,
  65,
  49,
  252,
  14,
  222,
  248,
  111,
  199,
  184,
  232,
  213,
  54,
  168,
  89,
  246,
  62,
  77,
  138,
  202,
  95,
  171,
  220,
  205,
  200,
  225,
  198,
  88,
  63,
  40,
  126,
  63,
  3,
  31,
  0,
  121,
  208,
  189,
  87,
  135,
  145,
  254,
  17,
  178,
  40,
  129,
  175,
  225,
  36,
  36,
  39,
  70,
  220,
  86,
  144,
  115,
  250,
  247,
  212,
  245,
  38,
  146,
  197,
  99,
  6,
  169,
  130,
  153,
  98,
  188,
  94,
  19,
  22,
  254,
  31,
  170,
  157,
  39,
  29,
  50,
  130,
  215,
  31,
  96,
  26,
  178,
  32,
  190,
  230,
  9,
  151,
  91,
  113,
  32,
  169,
  177,
  93,
  215,
  201,
  206,
  11,
  28,
  51,
  58,
  169,
  105,
  184,
  109,
  28,
  227,
  23,
  58,
  44,
  16,
  6,
  149,
  179,
  200,
  153,
  40,
  124,
  95,
  240,
  231,
  151,
  180,
  46,
  219,
  89,
  12,
  25,
  4,
  178,
  41,
  85,
  254,
  245,
  180,
  8,
  155,
  15,
  179,
  119,
  141,
  105,
  1,
  126,
  136,
  197,
  172,
  112,
  99,
  164,
  128,
  177,
  101,
  90,
  192,
  18,
  220,
  124,
  50,
  137,
  130,
  205,
  38,
  141,
  186,
  106,
  172,
  150,
  61,
  162,
  29,
  115,
  193,
  56,
  114,
  78,
  210,
  147,
  79,
  22,
  172,
  90,
  199,
  32,
  173,
  196,
  30,
  190,
  39,
  212,
  86,
  112,
  152,
  186,
  69,
  2,
  251,
  156,
  42,
  168,
  37,
  210,
  26,
  254,
  218,
  60,
  169,
  202,
  30,
  105,
  184,
  13,
  202,
  146,
  193,
  197,
  220,
  43,
  20,
  206,
  51,
  20,
  191,
  60,
  76,
  135,
  41,
  33,
  247,
  58,
  204,
  197,
  0,
  7,
  44,
  21,
  107,
  27,
  7
]);
