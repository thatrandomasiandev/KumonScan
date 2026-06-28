export function titleCase(str) {
  return str
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeName(firstName, lastName) {
  return {
    first_name: titleCase(firstName),
    last_name: titleCase(lastName),
  };
}

export function formatFullName(student) {
  return `${student.first_name} ${student.last_name}`;
}

export function validateNameField(value, fieldLabel) {
  const trimmed = (value ?? '').trim();

  if (!trimmed) {
    return `${fieldLabel} is required`;
  }

  if (trimmed.length > 50) {
    return `${fieldLabel} must be 50 characters or fewer`;
  }

  if (/^\d+$/.test(trimmed)) {
    return `${fieldLabel} cannot contain only numbers`;
  }

  return null;
}

export function splitFullName(name) {
  const parts = name.trim().split(/\s+/);
  const first_name = parts[0] || 'Unknown';
  const last_name = parts.slice(1).join(' ') || 'Student';
  return { first_name, last_name };
}
