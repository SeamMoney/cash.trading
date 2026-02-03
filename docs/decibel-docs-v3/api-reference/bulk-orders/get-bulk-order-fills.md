---
title: "Get bulk order fills"
url: "https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-order-fills"
scraped: "2026-02-03T21:43:34.244Z"
---

# Get bulk order fills

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Bulk Orders
Get bulk order fills
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
bulk\_order\_fills
Try it
Get bulk order fills
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/bulk_order_fills
```
200
Copy
Ask AI
```
[
{
"event_uid": 1,
"filled_size": 123,
"is_bid": true,
"market": "0xmarket123...",
"price": 123,
"sequence_number": 12345,
"trade_id": "3647276",
"transaction_unix_ms": 1730841600000,
"transaction_version": 12345,
"user": "0x123..."
}
]
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
User account address
[​
](#parameter-market)
market
string
Filter by specific market address
[​
](#parameter-sequence-number)
sequence\_number
integer<int64>
Single sequence number to query
Required range: `x >= 0`
[​
](#parameter-start-sequence-number)
start\_sequence\_number
integer<int64>
Start of sequence number range
Required range: `x >= 0`
[​
](#parameter-end-sequence-number)
end\_sequence\_number
integer<int64>
End of sequence number range. `start_sequence_number` is required if this is provided.
Required range: `x >= 0`
[​
](#parameter-pagination)
pagination
object
Pagination parameters
Show child attributes
#### Response
200
application/json
Bulk order fills retrieved successfully
[​
](#response-items-event-uid)
event\_uid
integer
required
Required range: `x >= 0`
[​
](#response-items-filled-size)
filled\_size
number<double>
required
[​
](#response-items-is-bid)
is\_bid
boolean
required
[​
](#response-items-market)
market
string
required
Example:
`"0xmarket123..."`
[​
](#response-items-price)
price
number<double>
required
[​
](#response-items-sequence-number)
sequence\_number
integer<int64>
required
Required range: `x >= 0`
Example:
`12345`
[​
](#response-items-trade-id)
trade\_id
string
required
Example:
`"3647276"`
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
[Get trades](/api-reference/market-data/get-trades)[Get bulk order status](/api-reference/bulk-orders/get-bulk-order-status)
⌘I