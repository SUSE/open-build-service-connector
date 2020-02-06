import { AccountStorage, ObsInstance } from "../../accounts";

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

export const fakeApi1Info: ObsInstance = {
  account: fakeAccount1
};

export const fakeApi2Info: ObsInstance = {
  account: fakeAccount2
};
