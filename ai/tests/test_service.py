import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from src.diagnosis.classifier import Classifier
from src.main import create_app
from src.rag.extract import readable_text

TOKEN = "test-only-internal-token-32-characters-long"


def test_vietnamese_font_names_decode_exactly_and_corrupt_encoding_is_rejected():
    assert readable_text("HƯ/uni1EDANG D/uni1EAAN") == "HƯỚNG DẪN"
    with pytest.raises(ValueError):
        readable_text("Broken VietGAP: \u0019\u0011")


def picture():
    stream = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(stream, format="PNG")
    return stream.getvalue()


def pdf(text=True, encrypted=False):
    writer = PdfWriter()
    page = writer.add_blank_page(300, 300)
    if text:
        font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}))
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 20 200 Td (Water durian roots carefully.) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(content)
    if encrypted:
        writer.encrypt("fixture-only")
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


def classifier(tmp_path, task="classify"):
    path = tmp_path / "best.pt"
    path.write_bytes(b"fixture-contract-only-not-a-trained-model")
    loads = []

    class Values:
        def cpu(self): return self
        def tolist(self): return [0.2, 0.7, 0.1]

    class FakeModel:
        names = {0: "healthy", 1: "disease", 2: "other"}
        def predict(self, **kwargs):
            assert kwargs["save"] is False
            return [SimpleNamespace(probs=SimpleNamespace(data=Values()))]

    def load(_path):
        loads.append(_path)
        model = FakeModel()
        model.task = task
        return model
    return Classifier(path, loader=load), loads


def test_internal_auth_and_missing_model_are_explicit(tmp_path):
    client = TestClient(create_app(Classifier(tmp_path / "missing.pt"), TOKEN))
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
    auth = {"Authorization": "Bearer " + TOKEN}
    assert client.get("/health", headers=auth).json()["model_file_present"] is False
    assert client.post("/v1/classify", content=picture(), headers=auth).status_code == 503


def test_classification_is_lazy_singleton_with_top_scores_and_hash(tmp_path):
    runner, loads = classifier(tmp_path)
    client = TestClient(create_app(runner, TOKEN))
    for _ in range(2):
        response = client.post("/v1/classify", content=picture(), headers={"Authorization": "Bearer " + TOKEN})
        assert response.status_code == 200
        result = response.json()
        assert result["task"] == "classify"
        assert len(result["model_sha256"]) == 64
        assert [p["label"] for p in result["predictions"]] == ["disease", "healthy", "other"]
        assert result["predictions"][0]["confidence"] == 0.7
    assert len(loads) == 1


def test_model_readiness_requires_loading_and_retains_exact_class_names(tmp_path):
    runner, loads = classifier(tmp_path)
    client = TestClient(create_app(runner, TOKEN))
    auth = {"Authorization": "Bearer " + TOKEN}
    assert client.get("/v1/model").status_code == 401
    for _ in range(2):
        response = client.get("/v1/model", headers=auth)
        assert response.status_code == 200
        assert response.json()["classes"] == [
            {"class_id": 0, "label": "healthy"}, {"class_id": 1, "label": "disease"},
            {"class_id": 2, "label": "other"},
        ]
    assert len(loads) == 1
    runner, _ = classifier(tmp_path, "detect")
    assert TestClient(create_app(runner, TOKEN)).get("/v1/model", headers=auth).status_code == 503


def test_wrong_task_and_invalid_images_do_not_create_predictions(tmp_path):
    runner, _ = classifier(tmp_path, "detect")
    client = TestClient(create_app(runner, TOKEN))
    auth = {"Authorization": "Bearer " + TOKEN}
    assert client.post("/v1/classify", content=picture(), headers=auth).status_code == 503
    assert client.post("/v1/classify", content=b"<svg>payload</svg>", headers=auth).status_code == 422
    assert client.post("/v1/classify", content=b"x" * (5 * 1024 * 1024 + 1), headers=auth).status_code == 413


@pytest.mark.parametrize("data", [b"not pdf", pdf(False), pdf(True, True)])
def test_pdf_failures_are_sanitized(tmp_path, data):
    client = TestClient(create_app(Classifier(tmp_path / "missing.pt"), TOKEN))
    response = client.post("/v1/extract-pdf", content=data, headers={"Authorization": "Bearer " + TOKEN})
    assert response.status_code == 422
    assert "Traceback" not in response.text


def test_pdf_pages_keep_page_numbers_without_model_or_api(tmp_path):
    client = TestClient(create_app(Classifier(tmp_path / "missing.pt"), TOKEN))
    response = client.post("/v1/extract-pdf", content=pdf(), headers={"Authorization": "Bearer " + TOKEN})
    assert response.status_code == 200
    assert response.json()["page_count"] == 1
    assert response.json()["pages"][0]["page"] == 1
    assert "durian" in response.json()["pages"][0]["text"]
