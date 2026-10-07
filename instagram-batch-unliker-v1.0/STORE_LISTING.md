# Chrome Web Store submission notes

## Suggested title
Instagram Batch Unliker

## Short description
Batch-manage liked Instagram posts with target, batch size, speed, delay, pause, stop, and loop controls.

## Single purpose
Help users manage posts they have previously liked on Instagram by selecting and unliking them in configurable batches on Instagram's Your Activity > Interactions > Likes page.

## Category
Productivity

## Permission justifications

### storage
Stores only extension settings and local run state such as target count, batch size, timing preferences, pause state, and progress. No settings are sent to a remote server.

### activeTab
Allows the user-invoked extension to inspect the active tab URL and navigate the current tab as part of opening Instagram's Likes page. This permission is used only after the user invokes the extension.

### Host permission: https://www.instagram.com/*
Required for the extension's declared content script and for interaction with Instagram's Likes page. The content script is restricted to the Likes-page URL pattern.

## Data disclosure

The extension reads the Instagram Likes page only to provide the advertised user-facing automation. It does not send page data to a developer-operated server, sell data, use it for advertising, or use it for unrelated profiling.

## Support

Replace the developer-contact placeholder in privacy.html with a real support email or support page before submission.

## Important review note

Google's Chrome Web Store policies require accurate privacy disclosures, narrow permissions, a narrow single purpose, meaningful support, and working functionality. This package is structured to align with those requirements, but no code change can guarantee approval because Google makes the final review decision.
