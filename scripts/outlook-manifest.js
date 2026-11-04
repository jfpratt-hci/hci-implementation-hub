// Writes dist/hci-one-outlook-addin.xml, the Outlook add in manifest for HCI staff.
// Usage: ENTRA_APP_ID=<app id> node scripts/outlook-manifest.js <host>
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const host = (process.argv[2] || process.env.HOST || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const entra = process.env.ENTRA_APP_ID || (fs.existsSync(path.join(root, "manifest", ".appid")) ? fs.readFileSync(path.join(root, "manifest", ".appid"), "utf8").trim() : "");
if (!host || !entra) { console.error("Usage: ENTRA_APP_ID=<app id> node scripts/outlook-manifest.js <host>"); process.exit(1); }
const idFile = path.join(root, "manifest", ".outlookid");
const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, "utf8").trim() : crypto.randomUUID();
fs.writeFileSync(idFile, id + "\n");
const U = p => `https://${host}${p}`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0" xsi:type="MailApp">
  <Id>${id}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>HCI ONE</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="HCI ONE"/>
  <Description DefaultValue="Turn an email into an HCI ONE task or Help Desk ticket, and see the customer's open work."/>
  <IconUrl DefaultValue="${U("/outlook/icon-64.png")}"/>
  <HighResolutionIconUrl DefaultValue="${U("/outlook/icon-128.png")}"/>
  <SupportUrl DefaultValue="https://hci-tv.com"/>
  <AppDomains><AppDomain>https://${host}</AppDomain></AppDomains>
  <Hosts><Host Name="Mailbox"/></Hosts>
  <Requirements><Sets><Set Name="Mailbox" MinVersion="1.8"/></Sets></Requirements>
  <FormSettings><Form xsi:type="ItemRead"><DesktopSettings><SourceLocation DefaultValue="${U("/outlook/pane.html")}"/><RequestedHeight>450</RequestedHeight></DesktopSettings></Form></FormSettings>
  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or"><Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/></Rule>
  <DisableEntityHighlighting>false</DisableEntityHighlighting>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
      <Requirements><bt:Sets DefaultMinVersion="1.8"><bt:Set Name="Mailbox"/></bt:Sets></Requirements>
      <Hosts><Host xsi:type="MailHost"><DesktopFormFactor>
        <ExtensionPoint xsi:type="MessageReadCommandSurface"><OfficeTab id="TabDefault"><Group id="hciGroup"><Label resid="Group"/>
          <Control xsi:type="Button" id="hciBtn"><Label resid="Btn"/><Supertip><Title resid="Btn"/><Description resid="Tip"/></Supertip>
            <Icon><bt:Image size="16" resid="i16"/><bt:Image size="32" resid="i32"/><bt:Image size="80" resid="i80"/></Icon>
            <Action xsi:type="ShowTaskpane"><SourceLocation resid="Pane"/></Action></Control>
        </Group></OfficeTab></ExtensionPoint>
      </DesktopFormFactor></Host></Hosts>
      <Resources>
        <bt:Images><bt:Image id="i16" DefaultValue="${U("/outlook/icon-16.png")}"/><bt:Image id="i32" DefaultValue="${U("/outlook/icon-32.png")}"/><bt:Image id="i80" DefaultValue="${U("/outlook/icon-80.png")}"/></bt:Images>
        <bt:Urls><bt:Url id="Pane" DefaultValue="${U("/outlook/pane.html")}"/></bt:Urls>
        <bt:ShortStrings><bt:String id="Group" DefaultValue="HCI ONE"/><bt:String id="Btn" DefaultValue="HCI ONE"/></bt:ShortStrings>
        <bt:LongStrings><bt:String id="Tip" DefaultValue="Add this email to HCI ONE as a task or Help Desk ticket"/></bt:LongStrings>
      </Resources>
      ${process.env.SSO ? `<WebApplicationInfo><Id>${entra}</Id><Resource>api://${host}/${entra}</Resource><Scopes><Scope>openid</Scope><Scope>profile</Scope></Scopes></WebApplicationInfo>` : ""}
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
`;
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "hci-one-outlook-addin.xml");
fs.writeFileSync(out, xml);
console.log("wrote", out);
