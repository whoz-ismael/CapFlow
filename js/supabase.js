/**
 * supabase.js — CapFlow Supabase Client
 *
 * Initializes the shared Supabase client used by modules that need
 * direct database access (e.g. change_history logging).
 *
 * Prerequisite: run supabase/migrations/001_create_change_history.sql
 * in your Supabase SQL editor before using ChangeHistoryAPI.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://cyzrxztodzivbxrivkot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5enJ4enRvZHppdmJ4cml2a290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjgwODAsImV4cCI6MjA4NzM0NDA4MH0.Ij3BFNwQiMYNVeBOYJ8T5knswO2pJWOp6Z51IiJ3mYg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
