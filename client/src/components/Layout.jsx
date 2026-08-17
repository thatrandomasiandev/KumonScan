import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import TopAppBar from './TopAppBar';
import NavigationRail from './NavigationRail';
import BottomNav from './BottomNav';
import { md3Colors } from '../theme';

export default function Layout({ children }) {
  const { centerSlug } = useParams();
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
      <NavigationRail centerSlug={centerSlug} />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopAppBar scrolled={scrolled} centerSlug={centerSlug} />

        <Box
          component="main"
          sx={{
            flex: 1,
            pb: {
              xs: 'calc(72px + env(safe-area-inset-bottom))',
              md: 0,
            },
            overflow: 'visible',
            WebkitOverflowScrolling: 'touch',
            display: 'block',
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
