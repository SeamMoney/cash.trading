import { Theme } from "frosted-ui";

import { LaunchpadPage } from "@/components/launchpad/LaunchpadPage";

export default function Page() {
  return (
    <Theme
      appearance="dark"
      accentColor="lime"
      grayColor="gray"
      successColor="green"
      hasBackground={false}
      className="cash-trade-theme"
    >
      <LaunchpadPage />
    </Theme>
  );
}
