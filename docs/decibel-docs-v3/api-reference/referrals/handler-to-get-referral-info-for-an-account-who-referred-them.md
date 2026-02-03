---
title: "Handler to get referral info for an account (who referred them)"
url: "https://docs.decibel.trade/api-reference/referrals/handler-to-get-referral-info-for-an-account-who-referred-them"
scraped: "2026-02-03T21:43:41.172Z"
---

# Handler to get referral info for an account (who referred them)

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Referrals
Handler to get referral info for an account (who referred them)
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
referrals
/
account
/
{account}
Try it
Handler to get referral info for an account (who referred them)
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/referrals/account/{account}
```
200
Copy
Ask AI
```
{
"account": "<string>",
"is_active": 1,
"is_affiliate_referral": 1,
"referral_code": "<string>",
"referred_at_ms": 123,
"referrer_account": "<string>"
}
```
#### Path Parameters
[​
](#parameter-account)
account
string
required
The account address to look up referral info for
#### Response
200
application/json
Successfully retrieved account referral info
Account referral information - shows who referred this account
[​
](#response-account)
account
string
required
[​
](#response-is-active)
is\_active
integer<int32>
required
Whether the referral code is still active (can accept new referrals)
Required range: `x >= 0`
[​
](#response-is-affiliate-referral)
is\_affiliate\_referral
integer<int32>
required
Required range: `x >= 0`
[​
](#response-referral-code)
referral\_code
string
required
[​
](#response-referred-at-ms)
referred\_at\_ms
integer<int64>
required
[​
](#response-referrer-account)
referrer\_account
string
required
[Get total predeposit points and deposited amount across all users (Season 0)](/api-reference/predeposit-points/get-total-predeposit-points-and-deposited-amount-across-all-users-season-0)[Handler to get referrer statistics](/api-reference/referrals/handler-to-get-referrer-statistics)
⌘I