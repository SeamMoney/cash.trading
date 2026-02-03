---
title: "Get user trade history"
url: "https://docs.decibel.trade/api-reference/account/get-user-trade-history"
scraped: "2026-02-03T21:43:32.839Z"
---

# Get user trade history

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account
Get user trade history
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
trade\_history
Try it
Get user trade history
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/trade_history
```
200
Copy
Ask AI
```
{
"items": [
{
"account": "0x1234567890abcdef1234567890abcdef12345678",
"action": "buy",
"client_order_id": "client_order_abc",
"fee_amount": 123,
"is_funding_positive": true,
"is_profit": true,
"is_rebate": true,
"market": "0xmarket123456789abcdef",
"order_id": "12345",
"price": 50000.25,
"realized_funding_amount": 123,
"realized_pnl_amount": 123,
"size": 100.5,
"source": "OrderFill",
"trade_id": "3647276",
"transaction_unix_ms": 1634567890000,
"transaction_version": 3647276285
}
],
"total_count": 1
}
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
User account address
[​
](#parameter-order-id)
order\_id
string
Filter by specific order ID
[​
](#parameter-market)
market
string
Filter by market address
[​
](#parameter-pagination)
pagination
object
required
Pagination parameters (limit and offset)
Show child attributes
#### Response
200
application/json
Trade history retrieved successfully
[​
](#response-items)
items
object\[\]
required
The items in the current page
Show child attributes
[​
](#response-total-count)
total\_count
integer<int32>
required
The total number of items across all pages
Required range: `x >= 0`
[Get subaccounts](/api-reference/account/get-subaccounts)[Get account-owned vaults](/api-reference/vaults/get-account-owned-vaults)
⌘I