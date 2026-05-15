-- Real Google Drive folder URLs for payment confirmation links.
INSERT INTO yassmin.product_pdf_map (product_code, pdf_url, label_ar)
VALUES
  (
    'inner_compass',
    'https://drive.google.com/drive/folders/1zV6E_BOTnrcAclcl_Q19-P7VK8w_HedV?usp=sharing',
    'كتاب بوصلتك الداخلية'
  ),
  (
    'voltaren_social',
    'https://drive.google.com/drive/folders/1-2ArtMuJCtd61d2_8Fsp0GcazYdPuBNl?usp=sharing',
    'فولتارين السوشيال ميديا'
  )
ON CONFLICT (product_code) DO UPDATE
SET
  pdf_url = EXCLUDED.pdf_url,
  label_ar = EXCLUDED.label_ar,
  updated_at = now();
