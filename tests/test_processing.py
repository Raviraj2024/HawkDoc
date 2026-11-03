from types import SimpleNamespace

from app.services.processing import (ATTRIBUTE_ALIASES, ATTRIBUTE_ROLES, CHECKLIST_DOCUMENT_TYPES,
                                     _claim_index, document_processing_status, normalize)


def test_name_format_variation_is_compatible():
    assert normalize("full_name", " RAHUL   SHARMA ") == normalize("full_name", "Rahul Sharma")


def test_date_format_variation_is_compatible():
    assert normalize("date_of_birth", "12 March 1992") == normalize("date_of_birth", "12/03/1992")


def test_material_date_difference_stays_different():
    assert normalize("date_of_birth", "12 March 1992") != normalize("date_of_birth", "11 March 1992")


def test_semantic_aliases_cover_common_document_vocabulary():
    assert "contact_number" in ATTRIBUTE_ALIASES["mobile_number"]
    assert "monthly_gross_salary" in ATTRIBUTE_ALIASES["gross_monthly_income_inr"]
    assert "primary_subject" in ATTRIBUTE_ROLES["requested_amount"]


def test_document_checklist_types_match_classification_vocabulary():
    assert "bank_statements" in CHECKLIST_DOCUMENT_TYPES["recent_bank_statements"]
    assert "employment_verification_letter" in CHECKLIST_DOCUMENT_TYPES["employment_confirmation"]


def test_currency_and_date_alias_values_normalize_consistently():
    assert normalize("gross_monthly_income_inr", "INR 133,000.00") == normalize("gross_monthly_income_inr", "133,000.00")
    assert normalize("employment_start_date", "15 Apr 2021") == normalize("employment_start_date", "15 April 2021")
    assert normalize("employer_company_name", "WESTHAVEN SYSTEMS") == normalize("employer_company_name", "Westhaven Systems Private Limited")


def test_only_supported_document_types_enter_automatic_extraction():
    assert document_processing_status("employment_verification_letter", "supported") == "classified"
    assert document_processing_status("employment_verification_letter", "needs_confirmation") == "needs_review"
    assert document_processing_status("employment_verification_letter", "contradicted") == "needs_review"
    assert document_processing_status(None, "supported") == "needs_review"


def test_document_inventory_index_collapses_repeated_page_claim_context():
    claims = [
        SimpleNamespace(attribute="postal_zip_code", entity_role="applicant",
                        relation_context={"address_type": "bank_mailing"}, temporal_context=None),
        SimpleNamespace(attribute="postal_zip_code", entity_role="applicant",
                        relation_context={"address_type": "bank_mailing"}, temporal_context=None),
        SimpleNamespace(attribute="postal_zip_code", entity_role="applicant",
                        relation_context={"address_type": "residential"}, temporal_context=None),
    ]
    index = _claim_index(claims)
    assert len(index) == 2
    assert {item["relation_context"]["address_type"] for item in index} == {"bank_mailing", "residential"}

