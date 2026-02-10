import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useWallet, WalletItem, isInstallRequired } from '@aptos-labs/wallet-adapter-react';
import {
  groupAndSortWallets,
  WalletReadyState,
  type AdapterWallet,
  type AdapterNotDetectedWallet,
} from '@aptos-labs/wallet-adapter-core';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// Import wallet logo PNGs
import petraLogo from '../assets/wallet-logos/petra-logo.png';
import rainbowLogo from '../assets/wallet-logos/rainbow-logo.png';
import rabbyLogo from '../assets/wallet-logos/rabby-logo.png';
import backpackLogo from '../assets/wallet-logos/backpack-logo.png';


// Custom wallet icons - ALWAYS use these over adapter icons
const WALLET_ICONS: Record<string, string> = {
  'petra': petraLogo,
  'rainbow': rainbowLogo,
  'rabby': rabbyLogo,
  'phantom': 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTA4IiBoZWlnaHQ9IjEwOCIgdmlld0JveD0iMCAwIDEwOCAxMDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPgo=',
  'metamask': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjU2IDI0MCI+PHBhdGggZmlsbD0iI0UxNzcyNiIgZD0iTTI1MC4wNjYgMEwxNDAuMjE5IDgxLjI3OWwyMC40MjctNDcuOXoiLz48cGF0aCBmaWxsPSIjRTI3NjI1IiBkPSJtNi4xOTEuMDk2bDg5LjE4MSAzMy4yODlsMTkuMzk2IDQ4LjUyOHpNMjA1Ljg2IDE3Mi44NThsNDguNTUxLjkyNGwtMTYuOTY4IDU3LjY0MmwtNTkuMjQzLTE2LjMxMXptLTE1NS43MjEgMGwyNy41NTcgNDIuMjU1bC01OS4xNDMgMTYuMzEybC0xNi44NjUtNTcuNjQzeiIvPjxwYXRoIGZpbGw9IiNFMjc2MjUiIGQ9Im0xMTIuMTMxIDY5LjU1MmwxLjk4NCA2NC4wODNsLTU5LjM3MS0yLjcwMWwxNi44ODgtMjUuNDc4bC4yMTQtLjI0NXptMzEuMTIzLS43MTVsNDAuOSAzNi4zNzZsLjIxMi4yNDRsMTYuODg4IDI1LjQ3OGwtNTkuMzU4IDIuN3pNNzkuNDM1IDE3My4wNDRsMzIuNDE4IDI1LjI1OWwtMzcuNjU4IDE4LjE4MXptOTcuMTM2LS4wMDRsNS4xMzEgNDMuNDQ1bC0zNy41NTMtMTguMTg0eiIvPjxwYXRoIGZpbGw9IiNENUJGQjIiIGQ9Im0xNDQuOTc4IDE5NS45MjJsMzguMTA3IDE4LjQ1MmwtMzUuNDQ3IDE2Ljg0NmwuMzY4LTExLjEzNHptLTMzLjk2Ny4wMDhsLTIuOTA5IDIzLjk3NGwuMjM5IDExLjMwM2wtMzUuNTMtMTYuODMzeiIvPjxwYXRoIGZpbGw9IiMyMzM0NDciIGQ9Im0xMDAuMDA3IDE0MS45OTlsOS45NTggMjAuOTI4bC0zMy45MDMtOS45MzJ6bTU1Ljk4NS4wMDJsMjQuMDU4IDEwLjk5NGwtMzQuMDE0IDkuOTI5eiIvPjxwYXRoIGZpbGw9IiNDQzYyMjgiIGQ9Im04Mi4wMjYgMTcyLjgzbC01LjQ4IDQ1LjA0bC0yOS4zNzMtNDQuMDU1em05MS45NS4wMDFsMzQuODU0Ljk4NGwtMjkuNDgzIDQ0LjA1N3ptMjguMTM2LTQ0LjQ0NGwtMjUuMzY1IDI1Ljg1MWwtMTkuNTU3LTguOTM3bC05LjM2MyAxOS42ODRsLTYuMTM4LTMzLjg0OXptLTE0OC4yMzcgMGw2MC40MzUgMi43NDlsLTYuMTM5IDMzLjg0OWwtOS4zNjUtMTkuNjgxbC0xOS40NTMgOC45MzV6Ii8+PHBhdGggZmlsbD0iI0UyNzUyNSIgZD0ibTUyLjE2NiAxMjMuMDgybDI4LjY5OCAyOS4xMjFsLjk5NCAyOC43NDl6bTE1MS42OTctLjA1MmwtMjkuNzQ2IDU3Ljk3M2wxLjEyLTI4Ljh6bS05MC45NTYgMS44MjZsMS4xNTUgNy4yN2wyLjg1NCAxOC4xMTFsLTEuODM1IDU1LjYyNWwtOC42NzUtNDQuNjg1bC0uMDAzLS40NjJ6bTMwLjE3MS0uMTAxbDYuNTIxIDM1Ljk2bC0uMDAzLjQ2MmwtOC42OTcgNDQuNzk3bC0uMzQ0LTExLjIwNWwtMS4zNTctNDQuODYyeiIvPjxwYXRoIGZpbGw9IiNGNTg0MUYiIGQ9Im0xNzcuNzg4IDE1MS4wNDZsLS45NzEgMjQuOTc4bC0zMC4yNzQgMjMuNTg3bC02LjEyLTQuMzI0bDYuODYtMzUuMzM1em0tOTkuNDcxIDBsMzAuMzk5IDguOTA2bDYuODYgMzUuMzM1bC02LjEyIDQuMzI0bC0zMC4yNzUtMjMuNTg5eiIvPjxwYXRoIGZpbGw9IiNDMEFDOUQiIGQ9Im02Ny4wMTggMjA4Ljg1OGwzOC43MzIgMTguMzUybC0uMTY0LTcuODM3bDMuMjQxLTIuODQ1aDM4LjMzNGwzLjM1OCAyLjgzNWwtLjI0OCA3LjgzMWwzOC40ODctMTguMjlsLTE4LjcyOCAxNS40NzZsLTIyLjY0NSAxNS41NTNoLTM4Ljg2OWwtMjIuNjMtMTUuNjE3eiIvPjxwYXRoIGZpbGw9IiMxNjE2MTYiIGQ9Im0xNDIuMjA0IDE5My40NzlsNS40NzYgMy44NjlsMy4yMDkgMjUuNjA0bC00LjY0NC0zLjkyMWgtMzYuNDc2bC00LjU1NiA0bDMuMTA0LTI1LjY4MWw1LjQ3OC0zLjg3MXoiLz48cGF0aCBmaWxsPSIjNzYzRTFBIiBkPSJNMjQyLjgxNCAyLjI1TDI1NiA0MS44MDdsLTguMjM1IDM5Ljk5N2w1Ljg2NCA0LjUyM2wtNy45MzUgNi4wNTRsNS45NjQgNC42MDZsLTcuODk3IDcuMTkxbDQuODQ4IDMuNTExbC0xMi44NjYgMTUuMDI2bC01Mi43Ny0xNS4zNjVsLS40NTctLjI0NWwtMzguMDI3LTMyLjA3OHptLTIyOS42MjggMGw5OC4zMjYgNzIuNzc3bC0zOC4wMjggMzIuMDc4bC0uNDU3LjI0NWwtNTIuNzcgMTUuMzY1bC0xMi44NjYtMTUuMDI2bDQuODQ0LTMuNTA4bC03Ljg5Mi03LjE5NGw1Ljk1Mi00LjYwMWwtOC4wNTQtNi4wNzFsNi4wODUtNC41MjZMMCA0MS44MDl6Ii8+PHBhdGggZmlsbD0iI0Y1ODQxRiIgZD0ibTE4MC4zOTIgMTAzLjk5bDU1LjkxMyAxNi4yNzlsMTguMTY1IDU1Ljk4NmgtNDcuOTI0bC0zMy4wMi40MTZsMjQuMDE0LTQ2LjgwOHptLTEwNC43ODQgMGwtMTcuMTUxIDI1Ljg3M2wyNC4wMTcgNDYuODA4bC0zMy4wMDUtLjQxNkgxLjYzMWwxOC4wNjMtNTUuOTg1em04Ny43NzYtNzAuODc4bC0xNS42MzkgNDIuMjM5bC0zLjMxOSA1Ny4wNmwtMS4yNyAxNy44ODVsLS4xMDEgNDUuNjg4aC0zMC4xMTFsLS4wOTgtNDUuNjAybC0xLjI3NC0xNy45ODZsLTMuMzItNTcuMDQ1bC0xNS42MzctNDIuMjM5eiIvPjwvc3ZnPg==',
  'backpack': backpackLogo,
  'coinbase wallet': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNiIgZmlsbD0iIzAwNTJGRiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02NCAyNGMtMjIuMSAwLTQwIDE3LjktNDAgNDBzMTcuOSA0MCA0MCA0MCA0MC0xNy45IDQwLTQwLTE3LjktNDAtNDAtNDB6bTAgNjRjLTEzLjMgMC0yNC0xMC43LTI0LTI0czEwLjctMjQgMjQtMjQgMjQgMTAuNyAyNCAyNC0xMC43IDI0LTI0IDI0eiIvPjxyZWN0IHg9IjUyIiB5PSI1MiIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNCIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==',
  'nightly': 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhLS0gR2VuZXJhdG9yOiBBZG9iZSBJbGx1c3RyYXRvciAyOC4wLjAsIFNWRyBFeHBvcnQgUGx1Zy1JbiAuIFNWRyBWZXJzaW9uOiA2LjAwIEJ1aWxkIDApICAtLT4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iV2Fyc3R3YV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDg1MS41IDg1MS41IiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA4NTEuNSA4NTEuNTsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4NCgkuc3Qwe2ZpbGw6IzYwNjdGOTt9DQoJLnN0MXtmaWxsOiNGN0Y3Rjc7fQ0KPC9zdHlsZT4NCjxnPg0KCTxnIGlkPSJXYXJzdHdhXzJfMDAwMDAwMTQ2MDk2NTQyNTMxODA5NDY0NjAwMDAwMDg2NDc4NTIwMDIxMTY5MTg2ODhfIj4NCgkJPHBhdGggY2xhc3M9InN0MCIgZD0iTTEyNCwwaDYwMy42YzY4LjUsMCwxMjQsNTUuNSwxMjQsMTI0djYwMy42YzAsNjguNS01NS41LDEyNC0xMjQsMTI0SDEyNGMtNjguNSwwLTEyNC01NS41LTEyNC0xMjRWMTI0DQoJCQlDMCw1NS41LDU1LjUsMCwxMjQsMHoiLz4NCgk8L2c+DQoJPGcgaWQ9IldhcnN0d2FfMyI+DQoJCTxwYXRoIGNsYXNzPSJzdDEiIGQ9Ik02MjMuNSwxNzAuM2MtMzcuNCw1Mi4yLTg0LjIsODguNC0xMzkuNSwxMTIuNmMtMTkuMi01LjMtMzguOS04LTU4LjMtNy44Yy0xOS40LTAuMi0zOS4xLDIuNi01OC4zLDcuOA0KCQkJYy01NS4zLTI0LjMtMTAyLjEtNjAuMy0xMzkuNS0xMTIuNmMtMTEuMywyOC40LTU0LjgsMTI2LjQtMi42LDI2My40YzAsMC0xNi43LDcxLjUsMTQsMTMyLjljMCwwLDQ0LjQtMjAuMSw3OS43LDguMg0KCQkJYzM2LjksMjkuOSwyNS4xLDU4LjcsNTEuMSw4My41YzIyLjQsMjIuOSw1NS43LDIyLjksNTUuNywyMi45czMzLjMsMCw1NS43LTIyLjhjMjYtMjQuNywxNC4zLTUzLjUsNTEuMS04My41DQoJCQljMzUuMi0yOC4zLDc5LjctOC4yLDc5LjctOC4yYzMwLjYtNjEuNCwxNC0xMzIuOSwxNC0xMzIuOUM2NzguMywyOTYuNyw2MzQuOSwxOTguNyw2MjMuNSwxNzAuM3ogTTI1My4xLDQxNC44DQoJCQljLTI4LjQtNTguMy0zNi4yLTEzOC4zLTE4LjMtMjAxLjVjMjMuNyw2MCw1NS45LDg2LjksOTQuMiwxMTUuM0MzMTIuOCwzNjIuMywyODIuMywzOTQuMSwyNTMuMSw0MTQuOHogTTMzNC44LDUxNy41DQoJCQljLTIyLjQtOS45LTI3LjEtMjkuNC0yNy4xLTI5LjRjMzAuNS0xOS4yLDc1LjQtNC41LDc2LjgsNDAuOUMzNjAuOSw1MTQuNywzNTMsNTI1LjQsMzM0LjgsNTE3LjV6IE00MjUuNyw2NzguNw0KCQkJYy0xNiwwLTI5LTExLjUtMjktMjUuNnMxMy0yNS42LDI5LTI1LjZzMjksMTEuNSwyOSwyNS42QzQ1NC43LDY2Ny4zLDQ0MS43LDY3OC43LDQyNS43LDY3OC43eiBNNTE2LjcsNTE3LjUNCgkJCWMtMTguMiw4LTI2LTIuOC00OS43LDExLjVjMS41LTQ1LjQsNDYuMi02MC4xLDc2LjgtNDAuOUM1NDMuOCw0ODgsNTM5LDUwNy42LDUxNi43LDUxNy41eiBNNTk4LjMsNDE0LjgNCgkJCWMtMjkuMS0yMC43LTU5LjctNTIuNC03Ni04Ni4yYzM4LjMtMjguNCw3MC42LTU1LjQsOTQuMi0xMTUuM0M2MzQuNiwyNzYuNSw2MjYuOCwzNTYuNiw1OTguMyw0MTQuOHoiLz4NCgk8L2c+DQo8L2c+DQo8L3N2Zz4NCg==',
  'okx wallet': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJDSURBVHgB7Zq9jtpAEMfHlhEgQLiioXEkoAGECwoKxMcTRHmC5E3IoyRPkPAEkI7unJYmTgEFTYwA8a3NTKScLnCHN6c9r1e3P2llWQy7M/s1Gv1twCP0ej37dDq9x+Zut1t3t9vZjDEHIiSRSPg4ZpDL5fxkMvn1cDh8m0teleZut1t3t9vZjDEHIiSRSPg4ZpDL5fxkMvn1cDh8m0wmfugfO53OoFQq/crn8wxfY9EymQyrVCqMfHvScZx1p9ls3pFxXBy/bKlUipGPrVbLuQqAfsCliq3zl0H84zwtjQrOw4Mt1W63P5LvBm2d+Xz+YzqdgkqUy+WgWCy+Mc/nc282m4FqLBYL+3g8fjDxenq72WxANZbLJeA13zDX67UDioL5ybXwafMYu64Ltn3bdDweQ5R97fd7GyhBQMipx4teleOeEDHIu2LfDdBIGGz+hJ9CQ1ABjoA2egAZPM6AgiCAEQhsi/C4jHyPA/6/f5NG3Ks2+3CYDC4aTccDrn6ojG54MnEvG00teleGIRNZ7wTCwDHYBsdACy0QHIhiuRETxlICWpMMhGZHmqS8qH6JLyGegAZKMDkI0uKf8X4SWlaZo+Pp1bRrwlJU8ZKLIvUjKh0WiQ3sRUbNVq9c5Ebew7KEo2m/1p4jJ4qAmDaqDQBzj5XyiAT4VCQezJigAU+IDU+z8vJFnGWeC+bKQV/5VZ71FV6L7PA3gg3tXrdQ+DgLhC+75Wq3no69P3MC0NFQpx2lL04Ql9gHK1bRDjsSBIvScBnDTk1WrlGIZBorIDEYJj+rhdgnQ67VmWRe0zlplXl81vcyEt0rSoYDUAAAAASUVORK5CYII=',
};

// Helper to get wallet icon - ALWAYS prefer custom icons
export const getWalletIcon = (walletName: string, fallbackIcon?: string): string => {
  const baseName = walletName.replace(' (Solana)', '').replace(' (Ethereum)', '').toLowerCase();
  // Always use our custom icons first - exact match
  if (WALLET_ICONS[baseName]) {
    return WALLET_ICONS[baseName];
  }
  // Fuzzy match for wallets like "Petra Aptos Wallet" -> petra
  for (const [key, icon] of Object.entries(WALLET_ICONS)) {
    if (baseName.includes(key)) {
      return icon;
    }
  }
  return fallbackIcon || '';
};

interface WalletSelectorProps {
  isOpen: boolean;
  onClose: () => void;
}

// Google icon SVG - full white
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// Apple icon SVG
const AppleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);

// Polymarket logo - official icon-blue.svg
const PolymarketLogo = () => (
  <svg width="56" height="56" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="rounded-lg">
    <rect width="512" height="512" fill="#2E5CFF" rx="80"/>
    <path d="M375.84 389.422C375.84 403.572 375.84 410.647 371.212 414.154C366.585 417.662 359.773 415.75 346.15 411.927L127.22 350.493C119.012 348.19 114.907 347.038 112.534 343.907C110.161 340.776 110.161 336.513 110.161 327.988V184.012C110.161 175.487 110.161 171.224 112.534 168.093C114.907 164.962 119.012 163.81 127.22 161.507L346.15 100.072C359.773 96.2495 366.585 94.338 371.212 97.8455C375.84 101.353 375.84 108.428 375.84 122.578V389.422ZM164.761 330.463L346.035 381.337V279.595L164.761 330.463ZM139.963 306.862L321.201 256L139.963 205.138V306.862ZM164.759 181.537L346.035 232.406V130.663L164.759 181.537Z" fill="white"/>
  </svg>
);

type ChainTab = 'Aptos' | 'Solana' | 'Ethereum';

// Wallet list row component
function WalletListRow({
  wallet,
  onConnect,
}: {
  wallet: AdapterWallet | AdapterNotDetectedWallet;
  onConnect: () => void;
}) {
  const walletIcon = getWalletIcon(wallet.name, wallet.icon);
  const needsInstall = isInstallRequired(wallet);
  const displayName = wallet.name;

  if (needsInstall) {
    return (
      <a
        href={wallet.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between py-3 px-2 hover:bg-[#2a3d4e] rounded-lg transition-colors"
      >
        <div className="flex items-center gap-3">
          {walletIcon ? (
            <img src={walletIcon} alt={wallet.name} className="w-10 h-10 rounded-xl" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-[#3a4f60] flex items-center justify-center">
              <span className="text-white font-bold text-lg">{wallet.name[0]}</span>
            </div>
          )}
          <span className="text-white font-medium">{displayName}</span>
        </div>
        <span className="text-white text-sm px-4 py-2 bg-[#2c9cdb] hover:bg-[#2589c4] rounded-lg font-medium min-w-[90px] text-center">Install</span>
      </a>
    );
  }

  return (
    <WalletItem wallet={wallet} onConnect={onConnect}>
      <WalletItem.ConnectButton asChild>
        <button className="w-full flex items-center justify-between py-3 px-2 hover:bg-[#2a3d4e] rounded-lg transition-colors">
          <div className="flex items-center gap-3">
            {walletIcon ? (
              <img src={walletIcon} alt={wallet.name} className="w-10 h-10 rounded-xl" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-[#3a4f60] flex items-center justify-center">
                <span className="text-white font-bold text-lg">{wallet.name[0]}</span>
              </div>
            )}
            <span className="text-white font-medium">{displayName}</span>
          </div>
          <span className="text-white text-sm px-4 py-2 bg-[#2c9cdb] hover:bg-[#2589c4] rounded-lg font-medium min-w-[90px] text-center">Connect</span>
        </button>
      </WalletItem.ConnectButton>
    </WalletItem>
  );
}

// Allowed wallets list
const ALLOWED_WALLETS = ['rainbow', 'metamask', 'rabby', 'phantom', 'backpack', 'petra'];

export function WalletSelector({ isOpen, onClose }: WalletSelectorProps) {
  const { wallets, notDetectedWallets = [], connected } = useWallet();
  const [selectedChain, setSelectedChain] = useState<ChainTab>('Aptos');

  // Close modal when connected
  useEffect(() => {
    if (connected && isOpen) {
      onClose();
    }
  }, [connected, isOpen, onClose]);

  // Memoize wallet grouping
  const { googleWallet, appleWallet, chainWallets } = useMemo(() => {
    const { petraWebWallets, availableWallets, installableWallets } = groupAndSortWallets(
      [...(wallets || []), ...notDetectedWallets]
    );

    // Find Google and Apple wallets from petraWebWallets
    const googleWallet = petraWebWallets.find(w => w.name.toLowerCase().includes('google'));
    const appleWallet = petraWebWallets.find(w => w.name.toLowerCase().includes('apple'));

    // Combine all wallets and filter to only allowed ones
    const allWallets = [
      ...availableWallets,
      ...installableWallets,
    ].filter(wallet => {
      const baseName = wallet.name.replace(' (Solana)', '').replace(' (Ethereum)', '').toLowerCase();
      return ALLOWED_WALLETS.some(allowed => baseName.includes(allowed));
    });

    // Categorize wallets by chain with deduplication
    const aptosWallets: (AdapterWallet | AdapterNotDetectedWallet)[] = [];
    const solanaWallets: (AdapterWallet | AdapterNotDetectedWallet)[] = [];
    const ethereumWallets: (AdapterWallet | AdapterNotDetectedWallet)[] = [];

    // Track seen wallet names per chain to dedupe
    const seenAptos = new Set<string>();
    const seenSolana = new Set<string>();
    const seenEthereum = new Set<string>();

    allWallets.forEach(wallet => {
      const name = wallet.name.toLowerCase();
      const baseName = name.replace(' (solana)', '').replace(' (ethereum)', '');

      if (name.includes('(solana)')) {
        if (!seenSolana.has(baseName)) {
          seenSolana.add(baseName);
          solanaWallets.push(wallet);
        }
      } else if (name.includes('(ethereum)')) {
        if (!seenEthereum.has(baseName)) {
          seenEthereum.add(baseName);
          ethereumWallets.push(wallet);
        }
      } else {
        // Default to Aptos (Petra, Nightly, etc.)
        if (!seenAptos.has(baseName)) {
          seenAptos.add(baseName);
          aptosWallets.push(wallet);
        }
      }
    });

    // Add wallets to Ethereum tab if not already present
    if (!seenEthereum.has('rabby')) {
      ethereumWallets.push({
        name: 'Rabby',
        icon: rabbyLogo,
        url: 'https://rabby.io/',
        readyState: WalletReadyState.NotDetected,
      } as AdapterNotDetectedWallet);
    }
    if (!seenEthereum.has('rainbow')) {
      ethereumWallets.push({
        name: 'Rainbow',
        icon: rainbowLogo,
        url: 'https://rainbow.me/',
        readyState: WalletReadyState.NotDetected,
      } as AdapterNotDetectedWallet);
    }
    if (!seenEthereum.has('metamask')) {
      ethereumWallets.push({
        name: 'MetaMask',
        icon: WALLET_ICONS['metamask'],
        url: 'https://metamask.io/',
        readyState: WalletReadyState.NotDetected,
      } as AdapterNotDetectedWallet);
    }

    // Add wallets to Solana tab if not already present
    if (!seenSolana.has('phantom')) {
      solanaWallets.push({
        name: 'Phantom',
        icon: WALLET_ICONS['phantom'],
        url: 'https://phantom.app/',
        readyState: WalletReadyState.NotDetected,
      } as AdapterNotDetectedWallet);
    }
    if (!seenSolana.has('backpack')) {
      solanaWallets.push({
        name: 'Backpack',
        icon: backpackLogo,
        url: 'https://backpack.app/',
        readyState: WalletReadyState.NotDetected,
      } as AdapterNotDetectedWallet);
    }

    return {
      googleWallet,
      appleWallet,
      chainWallets: {
        Aptos: aptosWallets,
        Solana: solanaWallets,
        Ethereum: ethereumWallets,
      },
    };
  }, [wallets, notDetectedWallets]);

  const displayWallets = chainWallets[selectedChain];

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed top-0 left-0 right-0 bottom-0 z-[9999] bg-[#1c2b3a]"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Close button - TOP LEFT */}
          <div className="p-4">
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#2a3d4e] rounded-lg transition-colors"
            >
              <X size={20} className="text-[#8297a3]" />
            </button>
          </div>

          {/* Main content - centered */}
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="w-full max-w-md">
              {/* Centered Logo and Welcome */}
              <div className="flex flex-col items-center pb-8">
                <PolymarketLogo />
                <h2 className="mt-4 text-2xl font-semibold text-white">Welcome to Polymarket</h2>
              </div>

              {/* Continue with Google Button */}
              {googleWallet && (
                <div className="pb-2">
                  <WalletItem wallet={googleWallet} onConnect={onClose}>
                    <WalletItem.ConnectButton asChild>
                      <button className="w-full flex items-center justify-center gap-3 py-3.5 bg-[#2c9cdb] hover:bg-[#2589c4] rounded-lg transition-colors">
                        <GoogleIcon />
                        <span className="text-white font-medium">Continue with Google</span>
                      </button>
                    </WalletItem.ConnectButton>
                  </WalletItem>
                </div>
              )}

              {/* Continue with Apple Button */}
              {appleWallet && (
                <div className="pb-4">
                  <WalletItem wallet={appleWallet} onConnect={onClose}>
                    <WalletItem.ConnectButton asChild>
                      <button className="w-full flex items-center justify-center gap-3 py-3.5 bg-black hover:bg-gray-900 rounded-lg transition-colors">
                        <AppleIcon />
                        <span className="text-white font-medium">Continue with Apple</span>
                      </button>
                    </WalletItem.ConnectButton>
                  </WalletItem>
                </div>
              )}

              {/* OR Divider */}
              <div className="flex items-center gap-4 py-4">
                <div className="flex-1 h-px bg-[#3a4f60]" />
                <span className="text-sm text-[#6b7a8a] font-medium">OR</span>
                <div className="flex-1 h-px bg-[#3a4f60]" />
              </div>

              {/* Chain Tabs */}
              <div className="pb-4">
                <div className="flex bg-[#0d1821] rounded-lg p-1">
                  {(['Aptos', 'Solana', 'Ethereum'] as ChainTab[]).map((chain) => (
                    <button
                      key={chain}
                      onClick={() => setSelectedChain(chain)}
                      className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
                        selectedChain === chain
                          ? 'bg-[#2a3d4e] text-white'
                          : 'text-[#6b7a8a] hover:text-white'
                      }`}
                    >
                      {chain}
                    </button>
                  ))}
                </div>
              </div>

              {/* Wallet List */}
              <div className="py-2 h-64 overflow-y-auto">
                {displayWallets.length > 0 ? (
                  displayWallets.map(wallet => (
                    <WalletListRow
                      key={wallet.name}
                      wallet={wallet}
                      onConnect={onClose}
                    />
                  ))
                ) : (
                  <p className="text-[#6b7a8a] text-center py-4">No {selectedChain} wallets found</p>
                )}
              </div>
            </div>
          </div>

          {/* Terms & Privacy Footer */}
          <div className="flex justify-center gap-2 py-6 text-sm">
            <a href="#" className="text-[#6b7a8a] hover:text-[#8297a3] transition-colors">Terms</a>
            <span className="text-[#6b7a8a]">•</span>
            <a href="#" className="text-[#6b7a8a] hover:text-[#8297a3] transition-colors">Privacy</a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default WalletSelector;
