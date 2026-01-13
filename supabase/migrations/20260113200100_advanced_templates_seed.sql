-- Seed Task Templates
-- 23 templates with materials, skills, and keywords

-- Clear old templates if needed (be careful here, but for now we want to normalize)
-- DELETE FROM task_templates WHERE category NOT IN ('admin', 'financial');

-- A) Portões e motores
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('gate_motor', 'Portão veicular travado / não abre ou não fecha', 120, 2, 'critical', 0, ARRAY['PORTAO'], ARRAY['travado','não abre','nao abre','não fecha','nao fecha','portão','motor','parado'], '[
  {"name": "Placa do motor", "qty": 1, "unit": "un", "sku": "MTR-PLACA", "optional": true},
  {"name": "Engrenagem", "qty": 1, "unit": "un", "sku": "MTR-ENG", "optional": true},
  {"name": "Cremalheira (barra)", "qty": 1, "unit": "un", "sku": "CREM", "optional": true},
  {"name": "Fusível", "qty": 2, "unit": "un", "sku": "FUS", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": false}
]'::jsonb),

('gate_motor', 'Portão veicular – falha de acionamento (controle/botoeira)', 60, 1, 'critical', 0, ARRAY['PORTAO'], ARRAY['controle','botoeira','não aciona','nao aciona','remoto','clonar'], '[
  {"name": "Botoeira", "qty": 1, "unit": "un", "sku": "BOTOEIRA", "optional": true},
  {"name": "Controle remoto", "qty": 2, "unit": "un", "sku": "CTRL", "optional": true},
  {"name": "Fusível", "qty": 2, "unit": "un", "sku": "FUS", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": false}
]'::jsonb),

('gate_motor', 'Portão veicular – ajuste percurso / sensores / fim de curso', 120, 1, 'non_critical', 2, ARRAY['PORTAO'], ARRAY['percurso','sensores','fim de curso','batendo','ajuste'], '[
  {"name": "Fusível", "qty": 2, "unit": "un", "sku": "FUS", "optional": true},
  {"name": "Placa do motor", "qty": 1, "unit": "un", "sku": "MTR-PLACA", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": false}
]'::jsonb),

('gate_motor', 'Portão veicular – trilho/roldanas/desalinhamento', 180, 2, 'critical', 0, ARRAY['PORTAO'], ARRAY['trilho','roldana','desalinhado','pesado','pulando'], '[
  {"name": "Engrenagem", "qty": 1, "unit": "un", "sku": "MTR-ENG", "optional": true},
  {"name": "Cremalheira (barra)", "qty": 1, "unit": "un", "sku": "CREM", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": false}
]'::jsonb),

('gate_motor', 'Instalação/troca de motor de portão (serviço completo)', 240, 2, 'critical', 0, ARRAY['PORTAO'], ARRAY['instalação','troca de motor','novo motor','substituir motor'], '[
  {"name": "Placa do motor", "qty": 1, "unit": "un", "sku": "MTR-PLACA", "optional": true},
  {"name": "Engrenagem", "qty": 1, "unit": "un", "sku": "MTR-ENG", "optional": true},
  {"name": "Cremalheira (barra)", "qty": 1, "unit": "un", "sku": "CREM", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": false}
]'::jsonb);

-- B) Interfone
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('intercom', 'Central de interfone fora do ar (sem comunicação geral)', 240, 1, 'critical', 0, ARRAY['INTERFONE'], ARRAY['central','fora do ar','comunicação','geral','muda'], '[
  {"name": "Placa ramal", "qty": 1, "unit": "un", "sku": "INT-PL-RAMAL", "optional": true},
  {"name": "Placa fonte", "qty": 1, "unit": "un", "sku": "INT-PL-FONTE", "optional": true},
  {"name": "Conectores/terminais", "qty": 10, "unit": "un", "sku": "TERM", "optional": false},
  {"name": "Cabo (interfone/CI)", "qty": 20, "unit": "m", "sku": "CAB-INT", "optional": true}
]'::jsonb),

('intercom', 'Interfone – ramal/apartamento sem chamada', 60, 1, 'non_critical', 2, ARRAY['INTERFONE'], ARRAY['ramal','apartamento','sem chamada','não toca','mudo'], '[
  {"name": "Conectores/terminais", "qty": 10, "unit": "un", "sku": "TERM", "optional": false},
  {"name": "Cabo (interfone/CI)", "qty": 20, "unit": "m", "sku": "CAB-INT", "optional": true}
]'::jsonb),

('intercom', 'Reinstalação da central após assistência técnica', 120, 1, 'critical', 0, ARRAY['INTERFONE'], ARRAY['reinstalação','voltou','assistencia','central'], '[
  {"name": "Conectores/terminais", "qty": 10, "unit": "un", "sku": "TERM", "optional": false},
  {"name": "Placa fonte", "qty": 1, "unit": "un", "sku": "INT-PL-FONTE", "optional": true},
  {"name": "Placa ramal", "qty": 1, "unit": "un", "sku": "INT-PL-RAMAL", "optional": true}
]'::jsonb);

-- C) CFTV
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('cctv', 'Câmera estratégica sem imagem (portaria/entrada/elevador)', 120, 1, 'critical', 0, ARRAY['CFTV'], ARRAY['imagem','preto','elevador','portaria','entrada','sem video'], '[
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true},
  {"name": "Fonte 12V (câmera)", "qty": 1, "unit": "un", "sku": "PSU-12V", "optional": true},
  {"name": "Cabo HDMI", "qty": 1, "unit": "un", "sku": "HDMI", "optional": true},
  {"name": "Monitor", "qty": 1, "unit": "un", "sku": "MON", "optional": true},
  {"name": "PC (diagnóstico/configuração)", "qty": 1, "unit": "un", "sku": "PC", "optional": true}
]'::jsonb),

('cctv', 'Câmera sem imagem (ponto comum)', 60, 1, 'non_critical', 2, ARRAY['camera','sem imagem','ponto'], '[
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true},
  {"name": "Fonte 12V (câmera)", "qty": 1, "unit": "un", "sku": "PSU-12V", "optional": true}
]'::jsonb),

('cctv', 'Várias câmeras sem imagem (suspeita DVR/fonte geral)', 180, 1, 'critical', 0, ARRAY['várias','cameras','DVR','NVR','bip','preto'], '[
  {"name": "DVR/NVR", "qty": 1, "unit": "un", "sku": "DVR", "optional": true},
  {"name": "Fonte 12V (câmera)", "qty": 1, "unit": "un", "sku": "PSU-12V", "optional": true},
  {"name": "HD para DVR/NVR", "qty": 1, "unit": "un", "sku": "HDD-SURV", "optional": true},
  {"name": "Cabo HDMI", "qty": 1, "unit": "un", "sku": "HDMI", "optional": true},
  {"name": "Monitor", "qty": 1, "unit": "un", "sku": "MON", "optional": true},
  {"name": "PC (diagnóstico/configuração)", "qty": 1, "unit": "un", "sku": "PC", "optional": true},
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true}
]'::jsonb),

('cctv', 'DVR/NVR bip intermitente / falha de HD', 120, 1, 'critical', 0, ARRAY['bip','hd','gravando','gravação'], '[
  {"name": "HD para DVR/NVR", "qty": 1, "unit": "un", "sku": "HDD-SURV", "optional": true},
  {"name": "DVR/NVR", "qty": 1, "unit": "un", "sku": "DVR", "optional": true},
  {"name": "Cabo HDMI", "qty": 1, "unit": "un", "sku": "HDMI", "optional": true},
  {"name": "Monitor", "qty": 1, "unit": "un", "sku": "MON", "optional": true},
  {"name": "PC (diagnóstico/configuração)", "qty": 1, "unit": "un", "sku": "PC", "optional": true}
]'::jsonb),

('cctv', 'Acesso remoto (app) não funciona', 60, 1, 'non_critical', 2, ARRAY['app','celular','remoto','acesso','internet'], '[
  {"name": "PC (diagnóstico/configuração)", "qty": 1, "unit": "un", "sku": "PC", "optional": true}
]'::jsonb),

('cctv', 'Instalação de novo ponto de câmera', 180, 2, 'non_critical', 2, ARRAY['instalação','novo ponto','camera nova'], '[
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true},
  {"name": "Fonte 12V (câmera)", "qty": 1, "unit": "un", "sku": "PSU-12V", "optional": true}
]'::jsonb);

-- D) Antena coletiva
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('antenna', 'Sem sinal geral de TV (prédio todo)', 120, 1, 'critical', 0, ARRAY['ANTENACOLETIVA'], ARRAY['antena','sem sinal','tv','canais'], '[
  {"name": "Conector F", "qty": 10, "unit": "un", "sku": "CONN-F", "optional": false},
  {"name": "Splitter (divisor) 2/4/8", "qty": 1, "unit": "un", "sku": "SPLIT-COAX", "optional": true},
  {"name": "Módulo de potência (amplificador)", "qty": 1, "unit": "un", "sku": "AMP-PWR", "optional": true},
  {"name": "Antena coletiva (UHF/VHF)", "qty": 1, "unit": "un", "sku": "ANT-COL", "optional": true},
  {"name": "Cabo coaxial RG6", "qty": 30, "unit": "m", "sku": "RG6", "optional": true}
]'::jsonb),

('antenna', 'Falha em canais específicos / ajustes', 60, 1, 'non_critical', 2, ARRAY['canais','chuvisco','sinal fraco'], '[
  {"name": "Conector F", "qty": 10, "unit": "un", "sku": "CONN-F", "optional": false},
  {"name": "Splitter (divisor) 2/4/8", "qty": 1, "unit": "un", "sku": "SPLIT-COAX", "optional": true}
]'::jsonb);

-- E) Cerca elétrica / alarme
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('fence_alarm', 'Cerca elétrica inoperante', 120, 1, 'critical', 0, ARRAY['CERCAELETRICA'], ARRAY['cerca','choque','desligada','fiaçao'], '[
  {"name": "Isoladores", "qty": 10, "unit": "un", "sku": "ISO", "optional": true},
  {"name": "Cabo CCI", "qty": 20, "unit": "m", "sku": "CCI", "optional": true}
]'::jsonb),

('fence_alarm', 'Alarme – diagnóstico (sensores/sirene)', 120, 1, 'non_critical', 2, ARRAY['alarme','sensor','sirene','falso','disparando'], '[
  {"name": "Fonte 12V/24V", "qty": 1, "unit": "un", "sku": "PSU-12-24", "optional": true}
]'::jsonb);

-- F) Controle de acesso
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('access_control', 'Acesso pedestre – falha de liberação (porta/fecho)', 120, 1, 'critical', 0, ARRAY['CONTROLEDEACESSOPEDESTRE'], ARRAY['porta','pedestre','não abre','fecho','magnetico','botoeira'], '[
  {"name": "Fecho magnético", "qty": 1, "unit": "un", "sku": "FECHO-MAG", "optional": true},
  {"name": "Fonte 12V/24V", "qty": 1, "unit": "un", "sku": "PSU-12-24", "optional": true},
  {"name": "Botoeira", "qty": 1, "unit": "un", "sku": "BOTOEIRA", "optional": true},
  {"name": "Mola aérea", "qty": 1, "unit": "un", "sku": "MOLA-AEREA", "optional": true},
  {"name": "Cabo CCI", "qty": 20, "unit": "m", "sku": "CCI", "optional": true},
  {"name": "Módulo de acesso", "qty": 1, "unit": "un", "sku": "MOD-ACESSO", "optional": true}
]'::jsonb),

('access_control', 'Acesso veicular – falha (módulo/tag/controle)', 120, 1, 'critical', 0, ARRAY['CONTROLEDEACESSOVEICULAR'], ARRAY['tag','veiculo','clonar','leitora','tag não funciona'], '[
  {"name": "TAG de acesso", "qty": 10, "unit": "un", "sku": "TAG", "optional": true},
  {"name": "Controle remoto", "qty": 2, "unit": "un", "sku": "CTRL", "optional": true},
  {"name": "Módulo de acesso", "qty": 1, "unit": "un", "sku": "MOD-ACESSO", "optional": true},
  {"name": "Strobe / Sinaleiro", "qty": 1, "unit": "un", "sku": "STROBE", "optional": true},
  {"name": "Cabo CCI", "qty": 20, "unit": "m", "sku": "CCI", "optional": true}
]'::jsonb),

('access_control', 'Porta pedestre – ajustes (mola/fechadura/estrutura)', 120, 1, 'non_critical', 2, ARRAY['PORTODEPEDESTRE'], ARRAY['mola','ajustar','porta batendo','fechadura'], '[
  {"name": "Mola aérea", "qty": 1, "unit": "un", "sku": "MOLA-AEREA", "optional": true},
  {"name": "Fecho magnético", "qty": 1, "unit": "un", "sku": "FECHO-MAG", "optional": true},
  {"name": "Parafusos e buchas (kit)", "qty": 1, "unit": "kit", "sku": "KIT-PAR", "optional": true},
  {"name": "Fonte 12V/24V", "qty": 1, "unit": "un", "sku": "PSU-12-24", "optional": true},
  {"name": "Botoeira", "qty": 1, "unit": "un", "sku": "BOTOEIRA", "optional": true}
]'::jsonb);

-- G) Infraestrutura
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('infra', 'Passagem de cabo (curta)', 120, 2, 'non_critical', 2, ARRAY['CFTV','INTERFONE'], ARRAY['passagem de cabo','puxar cabo','cabo curto','um ponto'], '[
  {"name": "Cabo (interfone/CI)", "qty": 20, "unit": "m", "sku": "CAB-INT", "optional": true},
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true}
]'::jsonb),

('infra', 'Passagem de cabo (longa)', 240, 2, 'non_critical', 2, ARRAY['CFTV','INTERFONE'], ARRAY['passagem de cabo longa','muitos metros','vários pontos','infraestrutura','canaleta'], '[
  {"name": "Cabo (interfone/CI)", "qty": 20, "unit": "m", "sku": "CAB-INT", "optional": true},
  {"name": "Conector BNC", "qty": 10, "unit": "un", "sku": "BNC", "optional": true},
  {"name": "Conector RJ45", "qty": 10, "unit": "un", "sku": "RJ45", "optional": true}
]'::jsonb);

-- H) Genéricos
INSERT INTO task_templates (category, title, default_minutes, required_people, criticality, sla_business_days, required_skill_codes, match_keywords, default_materials)
VALUES 
('generic', 'Visita técnica / diagnóstico (geral)', 60, 1, 'non_critical', 2, ARRAY[]::text[], ARRAY['visita','diagnostico','verificar','orçamento'], '[]'::jsonb);
