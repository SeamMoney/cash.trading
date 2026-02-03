---
title: "Get bulk orders"
url: "https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-orders"
scraped: "2026-02-03T21:43:35.259Z"
---

# Get bulk orders

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Bulk Orders
Get bulk orders
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
bulk\_orders
Try it
Get bulk orders
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/bulk_orders
```
200
Copy
Ask AI
```
[
{
"ask_prices": [
101,
102,
103
],
"ask_sizes": [
1,
2,
3
],
"bid_prices": [
99,
98,
97
],
"bid_sizes": [
1,
2,
3
],
"cancelled_ask_prices": [],
"cancelled_ask_sizes": [],
"cancelled_bid_prices": [
100
],
"cancelled_bid_sizes": [
1
],
"event_uid": 1,
"market": "0xmarket123...",
"sequence_number": 12345,
"transaction_unix_ms": 1730841600000,
"transaction_version": 12345,
"user": "0x123...",
"previous_seq_num": 12344
}
]
```
#### Path Parameters
[​
](#parameter-account)
account
string
required
User account address
[​
](#parameter-one-of-0)
market
string | null
required
Filter by specific market address
#### Response
200
application/json
Bulk orders retrieved successfully
[​
](#response-items-ask-prices)
ask\_prices
number<double>\[\]
required
Example:
```
[101, 102, 103]
```
[​
](#response-items-ask-sizes)
ask\_sizes
number<double>\[\]
required
Example:
```
[1, 2, 3]
```
[​
](#response-items-bid-prices)
bid\_prices
number<double>\[\]
required
Example:
```
[99, 98, 97]
```
[​
](#response-items-bid-sizes)
bid\_sizes
number<double>\[\]
required
Example:
```
[1, 2, 3]
```
[​
](#response-items-cancelled-ask-prices)
cancelled\_ask\_prices
number<double>\[\]
required
Example:
```
[]
```
[​
](#response-items-cancelled-ask-sizes)
cancelled\_ask\_sizes
number<double>\[\]
required
Example:
```
[]
```
[​
](#response-items-cancelled-bid-prices)
cancelled\_bid\_prices
number<double>\[\]
required
Example:
```
[100]
```
[​
](#response-items-cancelled-bid-sizes)
cancelled\_bid\_sizes
number<double>\[\]
required
Example:
```
[1]
```
[​
](#response-items-event-uid)
event\_uid
integer
required
Required range: `x >= 0`
[​
](#response-items-market)
market
string
required
Example:
`"0xmarket123..."`
[​
](#response-items-sequence-number)
sequence\_number
integer<int64>
required
Required range: `x >= 0`
Example:
`12345`
[​
](#response-items-transaction-unix-ms)
transaction\_unix\_ms
integer<int64>
required
Example:
`1730841600000`
[​
](#response-items-transaction-version)
transaction\_version
integer<int64>
required
Required range: `x >= 0`
Example:
`12345`
[​
](#response-items-user)
user
string
required
Example:
`"0x123..."`
[​
](#response-items-previous-seq-num-one-of-0)
previous\_seq\_num
integer<int64> | null
Required range: `x >= 0`
Example:
`12344`
[Get bulk order status](/api-reference/bulk-orders/get-bulk-order-status)[Get leaderboard](/api-reference/analytics/get-leaderboard)
⌘I