import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import TopAppBar from './TopAppBar';
import NavigationRail from './NavigationRail';
import BottomNav from './BottomNav';
import { md3Colors } from '../theme';

export default function Layout({ children }) {
  const location = useLocation();
  const isScanPage = location.pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: md3Colors.background,
      }}
    >
      {!isScanPage && <NavigationRail />}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isScanPage && <TopAppBar scrolled={scrolled} onMenuClick={() => {}} />}

        <Box
          component="main"
          sx={{
            flex: 1,
            pb: { xs: 10, md: 0 },
            overflow: isScanPage ? 'hidden' : 'visible',
            display: isScanPage ? 'flex' : 'block',
            flexDirection: isScanPage ? 'column' : 'initial',
            minHeight: isScanPage ? 0 : 'auto',
            animation: 'pageEnter 300ms cubic-bezier(0.05, 0.7, 0.1, 1.0)',
            '@keyframes pageEnter': {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
          }}
        >
          {children}
        </Box>

        <BottomNav />
      </Box>
    </Box>
  );
}
