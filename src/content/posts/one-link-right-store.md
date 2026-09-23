---
title: One link, the right store
description: Why the BubbleNest download link renders a page before it redirects, and what it took to make the App Store button work inside Instagram.
date: 2026-08-09
---

BubbleNest is on both stores, which means every place I hand out a link is a small decision: App Store or Google Play? Bio links, QR codes on flyers, replies to comments. I wanted one URL that lands each person in the store they can actually install from. That is now `krylabs.com/bubblenest/download`, and it took eight commits in one day to get right.

## Render first, redirect second

The obvious version is a `location.replace()` in an inline script in the head, before anything paints. It was live for about an hour. Two things broke.

Safari showed a white flash, because starting a navigation mid-parse means the body never renders. Worse, Instagram's in-app browser blocks automatic cross-origin hops, so the page sat white forever with no way out. The user tapped a link in my bio and got nothing.

The fix is a rule I now apply everywhere: the page always renders its chooser first, two buttons, one per store, and only then tries to navigate. Two `requestAnimationFrame` callbacks, then the hop. The first callback runs before the first paint and the second after it. If the redirect is refused, the visitor is already looking at two working buttons. A blocked redirect becomes a no-op instead of a dead end.

## Apple gives iOS a scheme, not a page

Google Play worked inside Instagram from the start. The App Store button did not. Tapping it did nothing: no navigation, no error.

The reason is what Apple serves. Request any App Store URL with an iPhone user agent and it answers with a 301 to `itms-appss://apps.apple.com/...`. Not HTML, a URL scheme. Every form of the URL, with a locale, without, `itunes.com`, `?mt=8`, does the same. Play returns a real page that a webview can render. Apple returns a scheme that Instagram's webview refuses to hand to the system.

So the button in a known in-app browser does not try to be clever on first tap. It calls `window.open()` on an `x-safari-` prefixed URL, synchronously inside the tap so the user gesture is still live. That exact combination is the one documented to escape Instagram on iOS. Assigning the same URL to `location.href`, the obvious way to write it, is precisely the form that fails.

If the page is still visible a second later, the escape did not work, and it falls back to the `itms-appss://` scheme directly. If it is still there after that, it stops pretending. The status line says the browser is blocking the App Store, and a hint appears: tap the three dots at the top right, then "Open in external browser". That menu is the one route that works every time, because it belongs to the host app. There is also a copy-link button for people who would rather paste it into Safari themselves.

## Detecting "did it work"

Telling a successful hop from a swallowed tap is its own problem. The page listens for `pagehide` and `visibilitychange`. If the document goes hidden, the store opened. An earlier version also listened for `blur`, which fires on focus changes that are not departures, and it armed the success flag before the tap ever happened. That silently disabled the whole fallback chain. Now the flag resets on every tap.

## Small things that stayed

The page deliberately does not use the site's layout. It has to be usable in the first frame, so it cannot wait on anything shared. `?ref=` attribution rides along to whichever store wins, in each store's own dialect (`ct` for Apple, `referrer` for Play), including on the in-app tap path. `?platform=ios` or `?platform=android` forces a destination for per-platform QR codes. `?stay=1` suppresses the hop so the page can be reviewed. And `?debug=1` prints every decision on screen, because a store link that fails inside someone else's webview cannot be reproduced from my desk.

If you ship on both stores, the short version is: render the chooser, then redirect, and treat the Apple URL as a scheme, not a page.
