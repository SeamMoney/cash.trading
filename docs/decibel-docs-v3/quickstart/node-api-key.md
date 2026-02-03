---
title: "Client API Key Setup"
url: "https://docs.decibel.trade/quickstart/node-api-key"
scraped: "2026-02-03T21:44:01.279Z"
---

# Client API Key Setup

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Client API Key Setup
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#client-api-key-overview)
Client API Key Overview
Decibel’s GET APIs require a **Client API Key** for authentication. Without a valid Client API key, GET API requests will fail. The Client API key is used to authenticate requests to Decibel’s read-only endpoints.
**Required for GET APIs:** All GET API requests require a Client API key. Requests without a valid Client API key will be rejected.
## 
[​
](#getting-a-client-api-key)
Getting a Client API Key
To obtain a Client API key, you need to create one on Geomi:
1.  Visit [https://geomi.dev](https://geomi.dev)
2.  Sign up or log in to your account
3.  Navigate to the client keys section
4.  Generate a new client API key
5.  Copy and securely store your Client API key
**Geomi Account:** You’ll need a Geomi account to generate Client API keys. If you don’t have one, you can sign up at [https://geomi.dev](https://geomi.dev).
## 
[​
](#using-the-client-api-key)
Using the Client API Key
Once you have your Client API key, include it in the `Authorization` header of your HTTP requests:
Copy
Ask AI
```
Authorization: Bearer YOUR_CLIENT_API_KEY
```
### 
[​
](#example-requests)
Example Requests
Here are examples of making a GET request with the Client API key in different languages:
curl
TypeScript
Python
Copy
Ask AI
```
curl -X GET "https://api.decibel.trade/v1/markets" \
-H "Authorization: Bearer YOUR_CLIENT_API_KEY"
```
**Security Best Practices:** - Never commit your Client API key to version control - Store API keys in environment variables or secure key management systems - Rotate your API keys regularly - Use different keys for development and production environments
## 
[​
](#troubleshooting)
Troubleshooting
### 
[​
](#401-unauthorized-error)
401 Unauthorized Error
If you receive a `401 Unauthorized` error:
1.  Verify your Client API key is correct
2.  Ensure you’re using the `Bearer` token format: `Authorization: Bearer YOUR_KEY`
3.  Confirm your key hasn’t expired or been revoked on Geomi
### 
[​
](#403-forbidden-error)
403 Forbidden Error
If you receive a `403 Forbidden` error:
1.  Verify your Client API key is correct
2.  Check that your key has the necessary permissions
3.  Ensure the key is properly formatted in the Authorization header
## 
[​
](#next-steps)
Next Steps
Now that you have your Client API key set up, you can:
-   [Make Authenticated Requests](/quickstart/authenticated-requests) - Learn how to send authenticated requests
-   [Explore API Reference](/api-reference/openapi.json) - Browse the full API documentation
-   [Get Market Data](/quickstart/market-data) - Learn how to fetch market data
[TypeScript Starter Kit](/quickstart/typescript-starter-kit)[Market Data](/quickstart/market-data)
⌘I