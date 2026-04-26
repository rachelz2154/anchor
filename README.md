# Even G2 Hello World

Minimal Even Hub app for the Even G2. When loaded in the simulator or on hardware, it creates one full-screen text container that shows `Hello World` on the glasses.

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
