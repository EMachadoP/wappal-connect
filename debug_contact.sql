
SELECT id, name, phone, chat_id, chat_lid, chat_key, is_group 
FROM contacts 
WHERE chat_lid = '144723385778292@lid' 
   OR phone LIKE '%97438430%';
