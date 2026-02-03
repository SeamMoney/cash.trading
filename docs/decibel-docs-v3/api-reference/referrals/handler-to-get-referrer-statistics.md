---
title: "Handler to get referrer statistics"
url: "https://docs.decibel.trade/api-reference/referrals/handler-to-get-referrer-statistics"
scraped: "2026-02-03T21:43:41.652Z"
---

# Handler to get referrer statistics

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Referrals
Handler to get referrer statistics
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
referrals
/
stats
/
{account}
Try it
Handler to get referrer statistics
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/referrals/stats/{account}
```
200
Copy
Ask AI
```
{
"codes": [
"<string>"
],
"is_affiliate": 1,
"referrer_account": "<string>",
"total_codes_created": 1,
"total_referrals": 1
}
```
#### Path Parameters
[​
](#parameter-account)
account
string
required
The referrer's account address
#### Response
200
application/json
Successfully retrieved referrer stats
Referrer statistics
[​
](#response-codes)
codes
string\[\]
required
[​
](#response-is-affiliate)
is\_affiliate
integer<int32>
required
Required range: `x >= 0`
[​
](#response-referrer-account)
referrer\_account
string
required
[​
](#response-total-codes-created)
total\_codes\_created
integer<int64>
required
Required range: `x >= 0`
[​
](#response-total-referrals)
total\_referrals
integer<int64>
required
Required range: `x >= 0`
[Handler to get referral info for an account (who referred them)](/api-reference/referrals/handler-to-get-referral-info-for-an-account-who-referred-them)[Handler to get users referred by a referrer](/api-reference/referrals/handler-to-get-users-referred-by-a-referrer)
⌘I