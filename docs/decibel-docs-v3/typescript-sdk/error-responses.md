---
title: "Error responses"
url: "https://docs.decibel.trade/typescript-sdk/error-responses"
scraped: "2026-02-03T21:44:17.440Z"
---

# Error responses

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Error responses
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#place-order-to-subaccount)
place\_order\_to\_subaccount
Error Code
Module
Error Name
When It Occurs
1
builder\_code\_registry
EINVALID\_AMOUNT
Builder fees <= 0
1
tp\_sl\_utils
EINVALID\_TP\_SL\_PARAMETERS
Invalid TP/SL parameters
1
order\_placement\_utils
EINVALID\_MATCH\_COUNT
Match count validation error
1
clearinghouse\_perp
EINVALID\_ARGUMENT
Invalid argument
2
clearinghouse\_perp
EINVALID\_SIZE\_IS\_ZERO
Size == 0 in settlement
3
clearinghouse\_perp
EINVALID\_SIZE\_IS\_TOO\_LARGE
Size too large
4
builder\_code\_registry
EINVALID\_MAX\_FEE
Builder fees exceed max fee
4
perp\_market\_config
ESIZE\_NOT\_RESPECTING\_MIN\_SIZE
Size < min\_size
4
pending\_order\_tracker
E\_MAX\_REDUCE\_ONLY\_ORDERS\_EXCEEDED
Too many reduce-only orders
5
perp\_engine
EMARKET\_HALTED
Exchange is not open
5
clearinghouse\_perp
EINVALID\_PRICE\_IS\_TOO\_LARGE
Price too large
5
builder\_code\_registry
EBUILDER\_NOT\_REGISTERED
Builder not registered
5
pending\_order\_tracker
E\_INVALID\_REDUCE\_ONLY\_ORDER
Invalid reduce-only order
6
perp\_market\_config
EPRICE\_NOT\_RESPECTING\_TICKER\_SIZE
Price not multiple of ticker\_size
8
dex\_accounts
ENOT\_SUBACCOUNT\_OWNER\_OR\_LACKS\_PERP\_TRADING\_PERMISSIONS
Signer lacks trading permissions
8
clearinghouse\_perp
EINVALID\_SETTLE\_RESULT
Invalid settlement result
8
pending\_order\_tracker
EMAX\_FIXED\_SIZED\_PENDING\_REQS\_HIT
Max fixed-size pending requests exceeded
9
pending\_order\_tracker
EFULL\_SIZED\_PENDING\_REQ\_EXISTS
Full-sized pending request exists
10
perp\_market\_config
EINVALID\_PRICE
Price == 0
10
pending\_order\_tracker
EINVALID\_TP\_SL\_SIZE
Invalid TP/SL size
10
clearinghouse\_perp
EINVALID\_SETTLE\_OPEN\_INTEREST\_DELTA\_NEGATIVE
Negative open interest delta
11
perp\_market\_config
EINVALID\_SIZE
Size == 0
12
perp\_market\_config
EORDER\_SIZE\_TOO\_LARGE
Price × size too large
12
async\_matching\_engine
EINVALID\_TP\_SL\_FOR\_REDUCE\_ONLY
TP/SL with reduce\_only
13
async\_matching\_engine
EINVALID\_TP\_SL\_WITH\_TRIGGER\_CONDITION
TP/SL with stop\_price
13
clearinghouse\_perp
ESELF\_TRADE\_NOT\_ALLOWED
Taker == maker
14
async\_matching\_engine
EINVALID\_STOP\_PRICE
Invalid stop\_price
15
dex\_accounts
ESUBACCOUNT\_IS\_NOT\_ACTIVE
Subaccount is inactive
15
clearinghouse\_perp
ENOT\_REDUCE\_ONLY
Not reduce-only when expected
16
async\_matching\_engine
EINVALD\_WORK\_UNITS\_PER\_TRIGGER
Invalid work units
## 
[​
](#cancel-client-order-to-subaccount)
cancel\_client\_order\_to\_subaccount
Error Code
Module
Error Name
When It Occurs
2
pending\_order\_tracker
E\_MARKET\_NOT\_FOUND
Market not found in account’s pending orders
3
pending\_order\_tracker
E\_INVALID\_ORDER\_CLEANUP\_SIZE
Invalid order cleanup size (size mismatch or price×size mismatch)
5
perp\_engine
EMARKET\_HALTED
Exchange is not open
16
async\_matching\_engine
EINVALD\_WORK\_UNITS\_PER\_TRIGGER
Invalid work units (should not occur with DEFAULT\_WORK\_UNITS\_PER\_TRIGGER=5)
## 
[​
](#place-bulk-orders-to-subaccount)
place\_bulk\_orders\_to\_subaccount
Error Code
Module
Error Name
When It Occurs
1
clearinghouse\_perp
EINVALID\_ARGUMENT
Prices/sizes length mismatch in get\_effective\_price\_and\_size
3
clearinghouse\_perp
EINVALID\_SIZE\_IS\_TOO\_LARGE
Total size exceeds I64\_MAX
4
perp\_market\_config
ESIZE\_NOT\_RESPECTING\_MIN\_SIZE
Any size < min\_size
5
perp\_engine
EMARKET\_HALTED
Exchange is not open
5
clearinghouse\_perp
EINVALID\_PRICE\_IS\_TOO\_LARGE
Effective price exceeds I64\_MAX
6
perp\_market\_config
EPRICE\_NOT\_RESPECTING\_TICKER\_SIZE
Any price not multiple of ticker\_size
8
dex\_accounts
ENOT\_SUBACCOUNT\_OWNER\_OR\_LACKS\_PERP\_TRADING\_PERMISSIONS
Signer lacks trading permissions
10
perp\_market\_config
EINVALID\_PRICE
Any price == 0
11
perp\_market\_config
EINVALID\_SIZE
Any size == 0
12
perp\_market\_config
EORDER\_SIZE\_TOO\_LARGE
Any price × size too large
13
perp\_market\_config
EPRICE\_SIZES\_LENGTH\_MISMATCH
Prices length != sizes length
15
dex\_accounts
ESUBACCOUNT\_IS\_NOT\_ACTIVE
Subaccount is inactive
16
async\_matching\_engine
EINVALD\_WORK\_UNITS\_PER\_TRIGGER
Invalid work units
## 
[​
](#cancel-bulk-order-to-subaccount)
cancel\_bulk\_order\_to\_subaccount
Error Code
Module
Error Name
When It Occurs
5
perp\_engine
EMARKET\_HALTED
Exchange is not open
8
dex\_accounts
ENOT\_SUBACCOUNT\_OWNER\_OR\_LACKS\_PERP\_TRADING\_PERMISSIONS
Signer lacks trading permissions
15
dex\_accounts
ESUBACCOUNT\_IS\_NOT\_ACTIVE
Subaccount is inactive
[Write SDK](/typescript-sdk/write-sdk)[Advanced](/typescript-sdk/advanced)
⌘I