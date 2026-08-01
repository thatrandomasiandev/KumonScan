import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import TopAppBar from './TopAppBar';
import NavigationRail from './NavigationRail';
import BottomNav from './BottomNav';
import { md3Colors } from '../theme';
import { pagePath } from '../centerPath';

export default function Layout({ children }) {
  const location = useLocation();
  const { centerSlug } = useParams();
  const isScanPage = pagePath(location.pathname) === '/';
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
        minHeight: '100dvh',
        display: 'flex',
        bgcolor: md3Colors.background,
        pt: 'env(safe-area-inset-top)',
      }}
    >
      {!isScanPage && <NavigationRail centerSlug={centerSlug} />}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isScanPage && <TopAppBar scrolled={scrolled} centerSlug={centerSlug} />}

        <Box
          component="main"
          sx={{
            flex: 1,
            pb: {
              xs: 'calc(72px + env(safe-area-inset-bottom))',
              md: 0,
            },
            overflow: isScanPage ? 'auto' : 'visible',
            WebkitOverflowScrolling: 'touch',
            display: isScanPage ? 'flex' : 'block',
            flexDirection: isScanPage ? 'column' : 'initial',
            minHeight: isScanPage ? 0 : 'auto',
            animation: 'pageEnter 300ms cubic-bezier(0.05, 0.7, 0.1, 1.0)',
            '@keyframes pageEnter': {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
            },
          }}
        >
          {children}
        </Box>

        <BottomNav centerSlug={centerSlug} />
      </Box>
    </Box>
  );
}
