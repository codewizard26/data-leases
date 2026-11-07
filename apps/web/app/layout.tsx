import type {ReactNode} from 'react';
import './style.css';
import Providers from './providers';
export const metadata={title:'Data Leases | Agent console',description:'Discover agents, compare quotes and inspect paid, verified runs.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body><Providers>{children}</Providers></body></html>;}
