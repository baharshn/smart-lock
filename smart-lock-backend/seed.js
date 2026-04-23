require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const seed = async () => {
    // Şifreyi hashle
    const password_hash = await bcrypt.hash('admin123', 10);

    // Super admin oluştur
    const { data, error } = await supabase
        .from('users')
        .insert({
            display_name: 'Super Admin',
            email: 'superadmin@smartlock.com',
            password_hash,
            role: 'super_admin',
            fingerprint_slot: 0,
            is_active: true
        })
        .select()
        .single();

    if (error) {
        console.error('Hata:', error.message);
        return;
    }

    console.log('Super admin oluşturuldu:', data.email);
    console.log('Şifre: admin123');
};

seed();