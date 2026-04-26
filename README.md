# Even G2 Custom Message Tester

Minimal Even Hub app for the Even G2. It connects to the Even Hub bridge, creates a startup page on the glasses, and lets you send a custom text message on demand.

## Requirements

- Node.js 18+
- Even Realities mobile app for device testing
- Even G2 glasses for hardware testing

## Install

```bash
npm install
```

## Run locally

Start the dev server:

```bash
npm run dev
```

Preview in the simulator:

```bash
npm run simulate
```

Load on a real device with a QR code:

```bash
npx evenhub qr --url "http://YOUR_LAN_IP:5173"
```

## Use it

1. Open the app in the simulator or on-device.
2. Wait for the bridge connection message.
3. Type a message in the text box.
4. Click `Send message` or press `Cmd/Ctrl+Enter`.

## Build an installable package

```bash
npm run pack
```

That creates `anchor-hello-world.ehpk` in the project root.

## Deploy to Even Hub

1. Create the package with `npm run pack`.
2. Sign in to the Even Hub developer portal.
3. Upload `anchor-hello-world.ehpk` as a private build or submission.

## Notes

- `app.json` uses the current required `edition` from the Even docs: `202601`.
- `vite.config.ts` uses `base: './'` so packaged assets resolve correctly from inside the `.ehpk`.
- If `com.miles.anchorhelloworld` is already taken on Even Hub, change `package_id` in `app.json` before submission.
