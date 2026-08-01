import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import { resourcesApi } from '../resourcesApi';
import { useSnackbar } from './SnackbarProvider';
import { md3Colors, getElevatedSurface, shape } from '../theme';

const CATEGORY_OPTIONS = [
  { value: 'worksheet', label: 'Worksheet' },
  { value: 'pencil', label: 'Pencil' },
  { value: 'book', label: 'Book' },
  { value: 'other', label: 'Other' },
];

const COLUMNS = [
  { id: 'name', label: 'Material', numeric: false },
  { id: 'category', label: 'Category', numeric: false },
  { id: 'quantity_on_hand', label: 'On hand', numeric: true },
  { id: 'low_stock_threshold', label: 'Threshold', numeric: true },
  { id: 'low_stock', label: 'Status', numeric: false },
];

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find((o) => o.value === value)?.label || 'Other';
}

function compare(a, b, orderBy) {
  const av = a[orderBy];
  const bv = b[orderBy];
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'boolean' && typeof bv === 'boolean') return Number(av) - Number(bv);
  return String(av ?? '').localeCompare(String(bv ?? ''));
}

const EMPTY_FORM = { name: '', category: 'worksheet', quantity_on_hand: '0', low_stock_threshold: '5' };

export default function ResourceInventory() {
  const { showSnackbar } = useSnackbar();
  const [resources, setResources] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [orderBy, setOrderBy] = useState('name');
  const [order, setOrder] = useState('asc');
  const [restockTarget, setRestockTarget] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState('10');
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await resourcesApi.getResources();
      setResources(data.resources || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const list = [...resources];
    list.sort((a, b) => (order === 'asc' ? 1 : -1) * compare(a, b, orderBy));
    return list;
  }, [resources, order, orderBy]);

  const lowStockCount = resources.filter((r) => r.low_stock).length;

  function handleSort(columnId) {
    if (orderBy === columnId) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(columnId);
      setOrder('asc');
    }
  }

  async function handleRestock() {
    const quantity = Number(restockQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      showSnackbar('Restock quantity must be a positive whole number');
      return;
    }
    setBusy(true);
    try {
      const updated = await resourcesApi.restockResource(restockTarget.id, quantity);
      showSnackbar(`${updated.name}: ${updated.quantity_on_hand} on hand`);
      setRestockTarget(null);
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    const name = addForm.name.trim();
    if (!name) {
      showSnackbar('Material name is required');
      return;
    }
    const quantity = Number(addForm.quantity_on_hand);
    const threshold = Number(addForm.low_stock_threshold);
    if (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(threshold) || threshold < 0) {
      showSnackbar('Quantity and threshold must be whole numbers of 0 or more');
      return;
    }
    setBusy(true);
    try {
      const created = await resourcesApi.createResource({
        name,
        category: addForm.category,
        quantity_on_hand: quantity,
        low_stock_threshold: threshold,
      });
      showSnackbar(`${created.name} added to inventory`);
      setAddOpen(false);
      setAddForm(EMPTY_FORM);
      await load();
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 3,
        borderRadius: `${shape.large}px`,
        bgcolor: getElevatedSurface(1),
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          px: 3,
          py: 2,
          borderBottom: `1px solid ${md3Colors.outlineVariant}`,
        }}
      >
        <Inventory2OutlinedIcon sx={{ fontSize: 22, color: md3Colors.onSurfaceVariant }} />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="titleMedium">Materials inventory</Typography>
          <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
            Worksheets, books, and pencils. Stock decrements when usage is logged at check-out.
          </Typography>
        </Box>
        {lowStockCount > 0 && (
          <Chip
            size="small"
            label={`${lowStockCount} low stock`}
            sx={{ bgcolor: md3Colors.errorContainer, color: md3Colors.onErrorContainer, fontWeight: 500 }}
          />
        )}
        <Button
          variant="outlined"
          startIcon={<AddOutlinedIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ minHeight: 44 }}
        >
          Add material
        </Button>
      </Box>

      {error && (
        <Typography variant="bodyMedium" role="alert" sx={{ color: md3Colors.error, px: 3, py: 2 }}>
          {error}
        </Typography>
      )}

      {!error && loaded && resources.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 5, px: 2 }}>
          <Inventory2OutlinedIcon sx={{ fontSize: 40, color: md3Colors.outline, mb: 1 }} />
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            No materials tracked yet — add worksheet packs, books, or pencils to start
          </Typography>
        </Box>
      )}

      {resources.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Materials inventory">
            <TableHead>
              <TableRow>
                {COLUMNS.map((col) => (
                  <TableCell
                    key={col.id}
                    align={col.numeric ? 'right' : 'left'}
                    sortDirection={orderBy === col.id ? order : false}
                    sx={{ whiteSpace: 'nowrap', color: md3Colors.onSurfaceVariant }}
                  >
                    <TableSortLabel
                      active={orderBy === col.id}
                      direction={orderBy === col.id ? order : 'asc'}
                      onClick={() => handleSort(col.id)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((resource) => (
                <TableRow key={resource.id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{resource.name}</TableCell>
                  <TableCell>{categoryLabel(resource.category)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {resource.quantity_on_hand}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {resource.low_stock_threshold}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={resource.low_stock ? 'Low stock' : 'In stock'}
                      sx={{
                        fontWeight: 500,
                        bgcolor: resource.low_stock ? md3Colors.errorContainer : md3Colors.surfaceVariant,
                        color: resource.low_stock ? md3Colors.onErrorContainer : md3Colors.onSurfaceVariant,
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="text"
                      size="small"
                      onClick={() => {
                        setRestockTarget(resource);
                        setRestockQuantity('10');
                      }}
                      sx={{ minHeight: 36 }}
                    >
                      Restock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Dialog
        open={Boolean(restockTarget)}
        onClose={() => !busy && setRestockTarget(null)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Restock {restockTarget?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant, mb: 2 }}>
            Currently {restockTarget?.quantity_on_hand} on hand (threshold{' '}
            {restockTarget?.low_stock_threshold}).
          </Typography>
          <TextField
            label="Quantity to add"
            value={restockQuantity}
            onChange={(e) => setRestockQuantity(e.target.value)}
            type="number"
            inputProps={{ min: 1, step: 1 }}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRestockTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleRestock} disabled={busy}>
            {busy ? 'Restocking…' : 'Restock'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={addOpen}
        onClose={() => !busy && setAddOpen(false)}
        PaperProps={{ sx: { borderRadius: `${shape.extraLarge}px` } }}
      >
        <DialogTitle>Add material</DialogTitle>
        <Box component="form" onSubmit={handleAdd}>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: { sm: 400 } }}>
            <TextField
              label="Name"
              placeholder="e.g. Math Level 2A Worksheet Pack"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              required
              fullWidth
              autoFocus
            />
            <TextField
              select
              label="Category"
              value={addForm.category}
              onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
              fullWidth
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Starting quantity"
                value={addForm.quantity_on_hand}
                onChange={(e) => setAddForm((f) => ({ ...f, quantity_on_hand: e.target.value }))}
                type="number"
                inputProps={{ min: 0, step: 1 }}
                fullWidth
              />
              <TextField
                label="Low-stock threshold"
                value={addForm.low_stock_threshold}
                onChange={(e) => setAddForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
                type="number"
                inputProps={{ min: 0, step: 1 }}
                fullWidth
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Adding…' : 'Add material'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Paper>
  );
}
