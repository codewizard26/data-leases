'use client';

import type {ReactNode} from 'react';
import {PrivyProvider} from '@privy-io/react-auth';

/** Public Privy app ID, inlined at build time. Server credentials stay on the gateway. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export default function Providers({children}: {children: ReactNode}) {
 if (!PRIVY_APP_ID) return <>{children}</>;
 return <PrivyProvider appId={PRIVY_APP_ID} config={{
  loginMethods: ['email', 'google', 'wallet'],
  appearance: {theme: 'light', landingHeader: 'Sign in to Data Leases'},
  embeddedWallets: {ethereum: {createOnLogin: 'users-without-wallets'}},
 }}>{children}</PrivyProvider>;
}
