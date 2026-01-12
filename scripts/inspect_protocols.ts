import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://qoolzhzdcfnyblymdvbq.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvb2x6aHpkY2ZueWJseW1kdmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI4MDcyMTMsImV4cCI6MjA0ODM4MzIxM30.GPx-l6VBcFZ5myTkANicZQegZBJ5hUmpRUpKGQiZzEA";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkProtocols() {
    console.log('Fetching first protocol to check columns...');
    const { data, error } = await supabase
        .from('protocols')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns found:', Object.keys(data[0]));
        console.log('Sample data:', data[0]);
    } else {
        console.log('No protocols found in the table.');
    }
}

checkProtocols();
