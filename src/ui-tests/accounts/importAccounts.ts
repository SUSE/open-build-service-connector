/**
 * Copyright (c) 2021 SUSE LLC
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

import { expect } from "chai";
import { promises as fsPromises } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { before, describe, it, xit } from "mocha";
import { sleep } from "open-build-service-api/lib/util";
import { dirname, join } from "path";
import {
  EditorView,
  InputBox,
  ModalDialog,
  NotificationType,
  TextEditor,
  TreeItem,
  until,
  ViewSection,
  WelcomeContentButton,
  WelcomeContentSection,
  Workbench
} from "vscode-extension-tester";
import { DialogHandler } from "vscode-extension-tester-native";
import { getTmpPrefix } from "../../test/suite/utilities";
import { testUser } from "../testEnv";
import {
  BOOKMARKED_PROJECTS_SECTION_NAME,
  createAccountViaCommand,
  deleteAccount,
  ensureExtensionOpen,
  ensureFileNotPresent,
  enterTextIntoInputBox,
  focusOnSection,
  modifySettingsJson,
  openSettingsJson,
  SETTINGS_JSON,
  waitForElement,
  waitForNotifications,
  WaitForNotificationsOptions,
  waitForObsInstance,
  WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT
} from "../util";

const testAccount = {
  apiUrl: "https://api.foobar.xyz/",
  username: "testUser",
  password: "superSecret"
};

const testAccount2 = {
  apiUrl: "https://api.obs.name",
  username: "me",
  alias: "obsName",
  password: "password"
};

const FAIL_FILE = join(getTmpPrefix(), "mocklibsecret_error_message");

const OSCRC = join(process.env.HOME!, ".config", "osc", "oscrc");
const writeTestAccToOscrc = async (includeAcc2Password: boolean = false) => {
  await fsPromises.mkdir(dirname(OSCRC), { recursive: true });
  await fsPromises.writeFile(
    OSCRC,
    `
[general]
apiUrl = ${testAccount.apiUrl}

[${testAccount.apiUrl}]
user = ${testAccount.username}
pass = ${testAccount.password}

[${testAccount2.apiUrl}]
user = ${testAccount2.username}
aliases = ${testAccount2.alias}
`.concat(
      includeAcc2Password
        ? `pass = ${testAccount2.password}
`
        : ""
    )
  );
};

const dismisSingleNotificationWithRegex = async (
  messageRegex: RegExp | string,
  options: {
    actionToTake?: string;
    checkNotificationType?: NotificationType;
  } & WaitForNotificationsOptions = {
    ...WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT,
    actionToTake: "No"
  }
) => {
  const notif = await waitForNotifications(options);
  expect(notif).to.have.length(1);
  await notif[0].getMessage().should.eventually.match(messageRegex);

  if (options.checkNotificationType !== undefined) {
    await notif[0]
      .getType()
      .should.eventually.equal(options.checkNotificationType);
  }
  if (options?.actionToTake !== undefined) {
    await notif[0].takeAction(options?.actionToTake);
  } else {
    notif[0].dismiss();
  }
  await new Workbench().getDriver().wait(until.stalenessOf(notif[0]));
};

const getAccountCount = async () => {
  const section = await focusOnSection(BOOKMARKED_PROJECTS_SECTION_NAME);
  if ((await section.findWelcomeContent()) !== undefined) {
    return 0;
  }

  const bookmarksItem = await waitForElement(() =>
    section.findItem("My bookmarks")
  );

  const children = await (bookmarksItem as TreeItem).getChildren();
  return children.length;
};

describe("Account importing", function () {
  this.timeout(30000);

  before(ensureExtensionOpen);

  beforeEach(async () => {
    await (
      await new Workbench().openNotificationsCenter()
    ).clearAllNotifications();
  });

  describe("welcome content", () => {
    let bookmarksSection: ViewSection;
    let welcomeContent: WelcomeContentSection;

    before(async () => {
      bookmarksSection = await focusOnSection("Bookmarked Projects");
      const welcomeOrNot = await bookmarksSection.findWelcomeContent();
      expect(welcomeOrNot).to.not.equal(undefined);
      welcomeContent = welcomeOrNot!;
    });

    it("shows a button to import accounts from .oscrc", async () => {
      const elements = await welcomeContent.getContents();
      expect(elements).to.have.length(3);

      elements[0].should.equal(
        "You don't appear to have any Accounts configured."
      );
      await (elements[1] as WelcomeContentButton)
        .getTitle()
        .should.eventually.equal("Add a new Account");
      await (elements[2] as WelcomeContentButton)
        .getTitle()
        .should.eventually.equal("Import accounts from osc");
    });

    xit("notifies the user that no accounts were found", async () => {
      await (await welcomeContent.getButtons())[1].click();

      const nothingImported = await waitForNotifications();
      expect(nothingImported).to.have.length(1);
      await nothingImported[0]
        .getMessage()
        .should.eventually.match(/did not import any accounts/);
    });

    describe("no accounts present", () => {
      before(writeTestAccToOscrc);
      after(() => ensureFileNotPresent(OSCRC));
    });
  });

  describe("keytar failures", () => {
    const errMsg = "Failed to unlock keyring!";

    before(async () => {
      await fsPromises.writeFile(FAIL_FILE, errMsg);
      return writeTestAccToOscrc();
    });

    after(() => ensureFileNotPresent(FAIL_FILE));

    it("displays an error on importing accounts", async () => {
      const bench = new Workbench();
      await bench.executeCommand("vscodeObs.obsAccount.importAccountsFromOsrc");

      const errNotif = await waitForNotifications({ bench });

      expect(errNotif).to.have.length(1);
      await errNotif[0]
        .getType()
        .should.eventually.equal(NotificationType.Error);
      await errNotif[0]
        .getMessage()
        .should.eventually.match(new RegExp(errMsg));
    });

    it("displays an error message when creating a new account from scratch", async () => {
      const bench = new Workbench();
      await bench.executeCommand(
        "Add an existing account from the Open Build Service to the extension"
      );

      await createAccountViaCommand(
        { ...testAccount, accountName: "testAccount" },
        testAccount.password,
        { acceptHostUnreachable: true }
      );

      const errNotif = await waitForNotifications({ bench });
      expect(errNotif).to.have.length(1);
      await errNotif[0]
        .getType()
        .should.eventually.equal(NotificationType.Error);
      await errNotif[0]
        .getMessage()
        .should.eventually.match(new RegExp(errMsg));
    });

    it("displays an error when setting the password of an existing account", async () => {
      await ensureFileNotPresent(FAIL_FILE);

      const bench = new Workbench();
      await bench.executeCommand(
        "Add an existing account from the Open Build Service to the extension"
      );

      await createAccountViaCommand(
        { ...testAccount2, accountName: testAccount2.alias },
        testAccount2.password,
        { acceptHostUnreachable: true }
      );

      await fsPromises.writeFile(FAIL_FILE, errMsg);

      await bench.executeCommand("Set the password of a Build Service Account");

      await enterTextIntoInputBox("insecure");

      await dismisSingleNotificationWithRegex(new RegExp(errMsg), {
        actionToTake: undefined,
        checkNotificationType: NotificationType.Error
      });
    });

    it("successfully removes an account even if deleting the password fails", async () => {
      const bench = new Workbench();
      await bench.executeCommand("Remove an account from the settings");

      // await bench.getDriver().sleep(1000);

      const dialog = new ModalDialog();
      const msg = await dialog.getDetails();
      msg.should.match(new RegExp(testAccount2.apiUrl));
      msg.should.match(
        /the account for the api.*will be deleted, are you sure?/i
      );

      await dialog.pushButton("Yes");

      const notifications = await (
        await bench.openNotificationsCenter()
      ).getNotifications(NotificationType.Any);

      expect(notifications).to.have.length(0);

      const bookmarkSection = await focusOnSection("Bookmarked Projects");
      const welcomeContent = await bookmarkSection.findWelcomeContent();
      expect(welcomeContent).to.not.equal(undefined);
      expect(await welcomeContent!.getContents())
        .to.be.an("array")
        .and.have.length(3);
    });
  });

  describe("Importing accounts", () => {
    after(async () => {
      await deleteAccount(testAccount.apiUrl, testAccount.apiUrl);
      await deleteAccount(testAccount2.alias, testAccount2.apiUrl);
    });

    it("imports accounts with and without a password", async () => {
      const bench = new Workbench();
      await bench.executeCommand("vscodeObs.obsAccount.importAccountsFromOsrc");

      // one account has a password defined, so we will get prompted for the other:
      await enterTextIntoInputBox(testAccount2.password);

      // check that no errors are present
      const notifications = await (
        await bench.openNotificationsCenter()
      ).getNotifications(NotificationType.Any);
      expect(notifications).to.have.length(0);

      await waitForObsInstance(testAccount.apiUrl);
      await waitForObsInstance(testAccount2.alias);
    });

    it("warns that a instance is not reachable", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(
        {
          apiUrl: "https://this.should.not.be.reachable.fooobar",
          username: "foo",
          accountName: "foo"
        },
        "whatever",
        { stopAfterPasswordEntry: true }
      );
      await dismisSingleNotificationWithRegex(
        /the host serving.*unreachable.*add this account anyway/i
      );

      await getAccountCount().should.eventually.equal(existingAccountCount);
    });

    it("warns that the username and password are wrong", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(
        {
          apiUrl: "https://api.opensuse.org/",
          username: "hopefullyInvalid",
          accountName: "OBS"
        },
        "whateverThisAccountShouldNotExist",
        { stopAfterPasswordEntry: true }
      );

      await dismisSingleNotificationWithRegex(
        /could not authenticate.*add this account anyway/i
      );

      await getAccountCount().should.eventually.equal(existingAccountCount);
    });

    it("warns that the instance is not OBS", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(
        {
          apiUrl: "https://jsonplaceholder.typicode.com/todos/",
          username: "hopefullyInvalid",
          accountName: "OBS"
        },
        "whatever",
        { stopAfterPasswordEntry: true }
      );

      await dismisSingleNotificationWithRegex(
        /does not appear to be obs.*add this account anyway/i
      );

      await getAccountCount().should.eventually.equal(existingAccountCount);
    });
  });

  describe("SSL issues", () => {
    const badSslAcc = {
      apiUrl: "https://self-signed.badssl.com/",
      username: "foo",
      accountName: "badssl",
      caCert: `-----BEGIN CERTIFICATE-----
MIIDeTCCAmGgAwIBAgIJAPziuikCTox4MA0GCSqGSIb3DQEBCwUAMGIxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNpc2NvMQ8wDQYDVQQKDAZCYWRTU0wxFTATBgNVBAMMDCouYmFkc3NsLmNvbTAeFw0xOTEwMDkyMzQxNTJaFw0yMTEwMDgyMzQxNTJaMGIxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNpc2NvMQ8wDQYDVQQKDAZCYWRTU0wxFTATBgNVBAMMDCouYmFkc3NsLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMIE7PiM7gTCs9hQ1XBYzJMY61yoaEmwIrX5lZ6xKyx2PmzAS2BMTOqytMAPgLaw+XLJhgL5XEFdEyt/ccRLvOmULlA3pmccYYz2QULFRtMWhyefdOsKnRFSJiFzbIRMeVXk0WvoBj1IFVKtsyjbqv9u/2CVSndrOfEk0TG23U3AxPxTuW1CrbV8/q71FdIzSOciccfCFHpsKOo3St/qbLVytH5aohbcabFXRNsKEqveww9HdFxBIuGa+RuT5q0iBikusbpJHAwnnqP7i/dAcgCskgjZjFeEU4EFy+b+a1SYQCeFxxC7c3DvaRhBB0VVfPlkPz0sw6l865MaTIbRyoUCAwEAAaMyMDAwCQYDVR0TBAIwADAjBgNVHREEHDAaggwqLmJhZHNzbC5jb22CCmJhZHNzbC5jb20wDQYJKoZIhvcNAQELBQADggEBAGlwCdbPxflZfYOaukZGCaxYK6gpincX4Lla4Ui2WdeQxE95w7fChXvP3YkE3UYUE7mupZ0eg4ZILr/A0e7JQDsgIu/SRTUE0domCKgPZ8v99k3Avka4LpLK51jHJJK7EFgo3ca2nldd97GM0MU41xHFk8qaK1tWJkfrrfcGwDJ4GQPIiLlm6i0yHq1Qg1RypAXJy5dTlRXlCLd8ufWhhiwW0W75Va5AEnJuqpQrKwl3KQVewGj67WWRgLfSr+4QG1mNvCZb2CkjZWmxkGPuoP40/y7Yu5OFqxP5tAjj4YixCYTWEVA0pmzIzgBg+JIe3PdRy27T0asgQW/F4TY61Yk=
-----END CERTIFICATE-----
`
    };

    const certPath = join(process.env.HOME!, "badssl-com-chain.pem");

    before(() => fsPromises.writeFile(certPath, badSslAcc.caCert));
    after(() => ensureFileNotPresent(certPath));

    const badSslAccountCreationPost = async (existingAccountCount: number) => {
      await enterTextIntoInputBox(badSslAcc.accountName);
      await enterTextIntoInputBox("");
      await enterTextIntoInputBox("");

      const brokenSslInstance = await waitForObsInstance(badSslAcc.accountName);
      await brokenSslInstance
        .getTooltip()
        .should.eventually.match(/ssl error/i);

      await deleteAccount(badSslAcc.accountName, badSslAcc.apiUrl);

      await getAccountCount().should.eventually.equal(existingAccountCount);
    };

    it("warns that the certificate of the host is invalid", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(badSslAcc, "whatever", {
        stopAfterPasswordEntry: true
      });

      await dismisSingleNotificationWithRegex(
        new RegExp(
          `tried to connect to ${badSslAcc.apiUrl} but got a ssl error.*add a custom ca certificate`,
          "i"
        ),
        { checkNotificationType: NotificationType.Error, actionToTake: "No" }
      );

      await badSslAccountCreationPost(existingAccountCount);
    });

    it("allows to fetch the certificate from the bad host", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(badSslAcc, "whatever", {
        stopAfterPasswordEntry: true
      });

      await dismisSingleNotificationWithRegex(
        new RegExp(
          `tried to connect to ${badSslAcc.apiUrl} but got a ssl error.*add a custom ca certificate`,
          "i"
        ),
        { actionToTake: "Yes" }
      );

      const addCertInput = await InputBox.create();
      await addCertInput
        .getPlaceHolder()
        .should.eventually.match(
          new RegExp("How do you want to provide the CA certificate?")
        );
      await addCertInput.setText("Fetch automatically");
      await addCertInput.confirm();

      await dismisSingleNotificationWithRegex(
        /got the ca certificate for.*issuer common name.*issuer organization.*sha256 fingerprint.*add this certificate/i,
        { actionToTake: "Yes" }
      );

      // now the extension will complain that this is not OBS:
      await dismisSingleNotificationWithRegex(/does not appear to be obs/i, {
        actionToTake: "Yes"
      });

      await badSslAccountCreationPost(existingAccountCount);
    });

    it("allows to select a custom certificate for the bad ssl host from the file system", async () => {
      const existingAccountCount = await getAccountCount();

      await createAccountViaCommand(badSslAcc, "whatever", {
        stopAfterPasswordEntry: true
      });

      await dismisSingleNotificationWithRegex(
        new RegExp(
          `tried to connect to ${badSslAcc.apiUrl} but got a ssl error.*add a custom ca certificate`,
          "i"
        ),
        { actionToTake: "Yes" }
      );

      const addCertInput = await InputBox.create();
      await addCertInput
        .getPlaceHolder()
        .should.eventually.match(
          new RegExp("How do you want to provide the CA certificate?")
        );
      await addCertInput.setText("From the file system");
      await addCertInput.confirm();

      const selectCertDialog = await DialogHandler.getOpenDialog();

      await selectCertDialog.selectPath(certPath);
      await selectCertDialog.confirm();

      // now the extension will complain that this is not OBS:
      await dismisSingleNotificationWithRegex(/does not appear to be obs/i, {
        actionToTake: "Yes"
      });

      await badSslAccountCreationPost(existingAccountCount);
    });
  });

  describe("recheck connection", () => {
    const port = 9090;
    const accountName = "fake";

    const accountForFake = {
      apiUrl: `http://localhost:${port}/`,
      accountName,
      username: "irrelevant"
    };

    const configurationListener = (
      _req: IncomingMessage,
      resp: ServerResponse
    ) => {
      resp.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      sleep(3000).then(() => {
        resp.write(`<configuration>
  <title>Fake Open Build Service</title>
  <description>This is really a fake one</description>
  <schedulers></schedulers>
</configuration>
`);
        resp.end();
      });
    };
    let fakeObs = createServer(configurationListener);

    before(async () => {
      await createAccountViaCommand(accountForFake, testUser.password, {
        acceptHostUnreachable: true
      });
    });

    after(async () => {
      fakeObs.close();
      await deleteAccount(accountName, accountForFake.apiUrl);
    });

    it("adds an entry to the context menu to recheck the connection state", async () => {
      const fakeObsElement = await waitForObsInstance(accountName);

      const menu = await fakeObsElement.openContextMenu();
      // there should be 2 entries: recheck & open settings
      await menu.getItems().should.eventually.have.length(2);
      await (await menu.getItem(
        "(Re)check the state of a connection to the Open Build Service"
      ))!.select();
      // FIXME: what should we check here? nothing really changed here…
    });

    it("rechecks the account via a command", async () => {
      fakeObs.listen(port);

      const bench = new Workbench();
      await bench.executeCommand("vscodeObs.obsAccount.checkConnectionState");

      const progressNotif = await waitForNotifications({ bench });
      expect(progressNotif).to.have.length(1);
      await progressNotif[0].hasProgress().should.eventually.equal(true);
      await bench.getDriver().wait(until.stalenessOf(progressNotif[0]));

      const fakeObsElement = await waitForObsInstance(accountName);
      await fakeObsElement.getTooltip().should.eventually.equal(accountName);
    });

    it("automatically rechecks a connection when changing the settings", async () => {
      fakeObs.close();
      // break the account again
      await modifySettingsJson((settings) => {
        settings["vscode-obs.accounts"][0]["username"] = "bar";
        return settings;
      });

      const fakeObsElement = await waitForObsInstance(accountName);
      await fakeObsElement
        .getTooltip()
        .should.eventually.match(
          new RegExp(
            `the host serving ${accountForFake.apiUrl} is unreachable`,
            "i"
          )
        );
    });
  });

  describe("forceHttps flag", () => {
    beforeEach(() =>
      modifySettingsJson((acc) => {
        delete acc["vscode-obs.forceHttps"];
        return acc;
      })
    );

    afterEach(() =>
      modifySettingsJson((acc) => {
        acc["vscode-obs.forceHttps"] = false;
        return acc;
      })
    );

    after(() => deleteAccount(testUser.aliases[0], testUser.apiUrl));

    const createHttpAccount = async (): Promise<InputBox> => {
      await new Workbench().executeCommand(
        "vscodeObs.obsAccount.newAccountWizard"
      );

      await enterTextIntoInputBox("other (custom)");
      await enterTextIntoInputBox(testUser.apiUrl);

      const setForceHttpsInput = await InputBox.create();
      await setForceHttpsInput
        .getPlaceHolder()
        .should.eventually.match(/do you want to allow non-https urls/i);
      return setForceHttpsInput;
    };

    it("does not add an account when we don't allow http connections", async () => {
      const existingAccountCount = await getAccountCount();

      const setForceHttpsInput = await createHttpAccount();
      await setForceHttpsInput.setText("No");
      await setForceHttpsInput.confirm();

      const { editorView, settingsJsonEditor } = await openSettingsJson();
      expect(
        JSON.parse(await settingsJsonEditor.getText())["vscode-obs.forceHttps"]
      ).to.equal(undefined);

      await editorView.closeEditor(SETTINGS_JSON);

      await getAccountCount().should.eventually.equal(existingAccountCount);
    });

    it("offers us to set the force http flag when adding a http api", async () => {
      const existingAccountCount = await getAccountCount();

      const setForceHttpsInput = await createHttpAccount();
      await setForceHttpsInput.setText("Yes");
      await setForceHttpsInput.confirm();

      await enterTextIntoInputBox(testUser.username);
      await enterTextIntoInputBox(testUser.password);
      await enterTextIntoInputBox(testUser.aliases[0]);
      await enterTextIntoInputBox("");
      await enterTextIntoInputBox("");

      const miniObs = await waitForObsInstance(testUser.aliases[0]);
      await miniObs.getTooltip().should.eventually.equal(testUser.aliases[0]);

      const { editorView, settingsJsonEditor } = await openSettingsJson();

      JSON.parse(await settingsJsonEditor.getText())[
        "vscode-obs.forceHttps"
      ].should.equal(false);

      await editorView.closeEditor(SETTINGS_JSON);
      await getAccountCount().should.eventually.equal(existingAccountCount + 1);
    });
  });

  describe("open settings of account", () => {
    before(async () => {
      await writeTestAccToOscrc(true);
      await new Workbench().executeCommand(
        "vscodeObs.obsAccount.importAccountsFromOsrc"
      );
    });

    after(() =>
      Promise.all([
        ensureFileNotPresent(OSCRC),
        async () => {
          await deleteAccount(testAccount.apiUrl, testAccount.apiUrl);
          await deleteAccount(testAccount2.alias, testAccount2.apiUrl);
        }
      ])
    );

    it("opens the settings.json and puts the cursor to the correct position", async () => {
      const acc1Element = await waitForObsInstance(testAccount.apiUrl);

      const openSettingsElement = await (
        await acc1Element.openContextMenu()
      ).getItem("Open the settings of a account in the Open Build Service");
      expect(openSettingsElement).to.not.equal(undefined);
      // expect(await openSettingsElement!.select()).to.equal(undefined);
      await openSettingsElement!.select();
      try {
        if (!(await openSettingsElement!.isSelected())) {
          await openSettingsElement!.select();
        }
      } catch {}

      const editorView = await new EditorView().wait();
      await waitForElement(() => editorView.openEditor(SETTINGS_JSON));
      const settingsJsonEditor = new TextEditor();

      const [line, col] = await settingsJsonEditor.getCoordinates();
      const lineAtCursor = await settingsJsonEditor.getTextAtLine(line);
      lineAtCursor
        // columns are 1 based, arrays are zero based
        .slice(col - 1)
        .should.equal(`"apiUrl": "${testAccount.apiUrl}",`);
    });
  });
});
