import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

interface ProgramRow        extends RowDataPacket { program_id:        number }
interface SpecializationRow extends RowDataPacket { specialization_id: number }

const PROGRAM_NAME_MAP: Record<string, string> = {
  BSCS:               'Bachelor of Science in Computer Science',
  BSIT:               'Bachelor of Science in Information Technology',
  BMMA:               'Bachelor of Multimedia Arts',
  BSCyber:            'Bachelor of Science in Cybersecurity',
  BSDMM:             'Bachelor of Digital Marketing and Management',
  BSFTE:              'BS in Financial Technology Engineering Program',
  BSPT:               'Bachelor of Science in Physical Therapy',
  'DMD-General':       'Doctor of Dental Medicine - General Dentistry',
  'DMD-Orthodontics':  'Doctor of Dental Medicine - Orthodontics',
  'DMD-Prosthodontics':'Doctor of Dental Medicine - Prosthodontics',
  'DMD-Endodontics':   'Doctor of Dental Medicine - Endodontics',
  'DMD-Periodontics':  'Doctor of Dental Medicine - Periodontics',
  'DMD-Pediatric':     'Doctor of Dental Medicine - Pediatric Dentistry',
  'DMD-OralSurgery':   'Doctor of Dental Medicine - Oral Surgery',
  'DMD-Pathology':     'Doctor of Dental Medicine - Oral Pathology',
  'DMD-PublicHealth':  'Doctor of Dental Medicine - Public Health Dentistry',
  'DMD-Radiology':     'Doctor of Dental Medicine - Oral & Maxillofacial Radiology',
  BSMT:               'Bachelor of Science in Medical Technology',
  DO:                 'Doctor of Optometry',
  BSN:                'Bachelor of Science in Nursing',
};

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return err('Invalid request body.');

  const isGoogle = (body as Record<string, unknown>).google === true;

  const {
    first_name, middle_name, surname, dateofbirth,
    email, year_level, status, program, specialization,
    password, confirm,
  } = body as Record<string, string>;

  // Required fields
  if (!first_name?.trim() || !surname?.trim())
    return err('First name and surname are required.');
  if (!dateofbirth)
    return err('Date of birth is required.');
  if (!email?.trim())
    return err('Email is required.');
  if (!year_level || !status || !program)
    return err('Year level, status, and program are required.');
  if (!isGoogle && (!password || !confirm))
    return err('Password fields are required.');

  // Age check (15–100)
  const dob  = new Date(dateofbirth);
  const now  = new Date();
  const age  = now.getFullYear() - dob.getFullYear()
             - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
  if (age < 15 || age > 100)
    return err('Age must be between 15 and 100 years.');

  const cleanEmail = email.trim().toLowerCase();

  // Password match & strength (skipped for Google sign-ups — they never use credentials login)
  if (!isGoogle) {
    if (password !== confirm)
      return err('Passwords do not match.');
    if (password.length < 8)
      return err('Password must be at least 8 characters.');
  }

  // Program lookup
  const programName = PROGRAM_NAME_MAP[program];
  if (!programName)
    return err('Invalid program selected.');

  try {
    const [progRows] = await pool.execute<ProgramRow[]>(
      'SELECT program_id FROM programs WHERE program_name = ?',
      [programName],
    );
    if (progRows.length === 0)
      return err('Program not found in database. Please contact support.', 500);

    const program_id = progRows[0].program_id;

    // Specialization lookup
    const specName = specialization?.trim() || 'No Specialization';
    const [specRows] = await pool.execute<SpecializationRow[]>(
      'SELECT specialization_id FROM specializations WHERE program_id = ? AND specialization_name = ?',
      [program_id, specName],
    );
    if (specRows.length === 0)
      return err('Specialization not found. Please contact support.', 500);

    const specialization_id = specRows[0].specialization_id;

    // Hash & insert — Google sign-ups get a random password since they'll
    // always authenticate via Google, never the credentials form.
    const hashed = isGoogle
      ? await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
      : await bcrypt.hash(password, 10);

    await pool.execute(
      `INSERT INTO user_login
         (first_name, middle_name, surname, dateofbirth, email,
          year_level, status, program, specialization, password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        first_name.trim(),
        middle_name?.trim() || null,
        surname.trim(),
        dateofbirth,
        cleanEmail,
        year_level,
        status,
        program_id,
        specialization_id,
        hashed,
      ],
    );

    return Response.json({ message: 'Account created successfully.' }, { status: 201 });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException & { code?: string }).code === 'ER_DUP_ENTRY') {
      return err('An account with this email already exists.', 409);
    }
    console.error('[signup] DB error:', e);
    return err('Server error. Please try again later.', 500);
  }
}
