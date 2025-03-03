import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { setDraft, setPreview, loadDraftSuccess } from './slices/aiSlice';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const AISymptomAnalysis = ({ account, signer, token }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const { draft, preview, loading, error } = useSelector((state) => state.ai);
    const ws = useRef(null);
    const modalRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [prescriptions, setPrescriptions] = useState([]);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [mediPoints, setMediPoints] = useState(0);

    const symptomSchema = Yup.object({
        patientAddress: Yup.string()
            .matches(/^0x[a-fA-F0-9]{40}$/, t('invalid_address'))
            .required(t('patient_address_required')),
        symptoms: Yup.string()
            .max(1000, t('symptoms_max_length'))
            .required(t('symptoms_required')),
    });

    const prescriptionSchema = Yup.object({
        medicationHash: Yup.string()
            .matches(/^0x[a-fA-F0-9]{64}$/, t('invalid_hash'))
            .required(t('medication_hash_required')),
        dosage: Yup.string()
            .max(100, t('dosage_max_length'))
            .required(t('dosage_required')),
        refills: Yup.number()
            .min(0, t('refills_min'))
            .max(10, t('refills_max'))
            .required(t('refills_required')),
        duration: Yup.number()
            .min(1, t('duration_min'))
            .required(t('duration_required')),
        ipfsHash: Yup.string()
            .max(128, t('ipfs_hash_max_length'))
            .required(t('ipfs_hash_required')),
    });

    useEffect(() => {
        ws.current = new WebSocket(process.env.REACT_APP_WS_URL);
        ws.current.onopen = () => setIsConnected(true);
        ws.current.onclose = () => setIsConnected(false);
        ws.current.onerror = () => toast.error(t('websocket_error'));
        ws.current.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'prescriptionStatus') {
                setPrescriptions(prev => [...prev, data.data]);
                toast.success(t('prescription_updated'));
            } else if (data.type === 'aiAnalysisResult') {
                setAiAnalysis(data.data);
                toast.success(t('ai_analysis_received'));
            }
        };
        fetchPrescriptions();
        fetchMediPoints();
        return () => ws.current.close();
    }, [dispatch, t]);

    const fetchPrescriptions = async () => {
        try {
            const { data } = await axios.get(
                `${process.env.REACT_APP_API_URL}/patient-prescriptions/${account}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setPrescriptions(data.prescriptions);
        } catch (error) {
            toast.error(t('fetch_prescriptions_error'));
        }
    };

    const fetchMediPoints = async () => {
        try {
            const response = await axios.get(
                `${process.env.REACT_APP_API_URL}/patient/${account}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setMediPoints(response.data.gamification.mediPoints);
        } catch (error) {
            toast.error(t('fetch_medi_points_error'));
        }
    };

    const analyzeSymptoms = async (values) => {
        try {
            const { data } = await axios.post(
                `${process.env.REACT_APP_API_URL}/analyze-symptoms`,
                values,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            ws.current.send(JSON.stringify({ type: 'aiAnalysisUpdate', ipfsHash: data.ipfsHash }));
            toast.success(t('analysis_requested'));
        } catch (error) {
            toast.error(t('analyze_symptoms_error'));
        }
    };

    const issuePrescription = async (values) => {
        try {
            const signature = await signer.signMessage(`Issue prescription for ${account}`);
            const { data } = await axios.post(
                `${process.env.REACT_APP_API_URL}/issue-prescription`,
                { ...values, patientAddress: account, signature },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            toast.success(t('prescription_issued'));
            fetchPrescriptions();
        } catch (error) {
            toast.error(t('issue_prescription_error'));
        }
    };

    const refillPrescription = async (prescriptionId) => {
        try {
            const signature = await signer.signMessage(`Refill prescription ${prescriptionId}`);
            const { data } = await axios.post(
                `${process.env.REACT_APP_API_URL}/refill-prescription`,
                { prescriptionId, signature },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            toast.success(t('prescription_refilled'));
            fetchPrescriptions();
        } catch (error) {
            toast.error(t('refill_prescription_error'));
        }
    };

    const monetizeData = async () => {
        try {
            const signature = await signer.signMessage(`Monetize data for ${account}`);
            const { data } = await axios.post(
                `${process.env.REACT_APP_API_URL}/monetize-data`,
                { signature },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            toast.success(t('data_monetized', { reward: data.reward }));
            fetchMediPoints();
        } catch (error) {
            toast.error(t('monetize_data_error'));
        }
    };

    return (
        <div className="container mx-auto p-6 bg-gray-50 rounded-lg shadow-lg">
            <h1 className="text-3xl font-bold mb-6 text-blue-600">{t('telemedicine_dashboard')}</h1>
            <div className="mb-4 flex items-center">
                <span className={`h-3 w-3 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <span>{isConnected ? t('connected') : t('disconnected')}</span>
                <span className="ml-4">MediPoints: {mediPoints}</span>
            </div>

            {/* AI Symptom Analysis */}
            <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4 text-blue-600">{t('ai_symptom_analysis')}</h2>
                <Formik
                    initialValues={{ patientAddress: account, symptoms: '' }}
                    validationSchema={symptomSchema}
                    onSubmit={analyzeSymptoms}
                >
                    {({ isSubmitting }) => (
                        <Form className="space-y-6">
                            <div>
                                <label htmlFor="symptoms" className="block text-sm font-medium text-gray-700">
                                    {t('symptoms')}
                                </label>
                                <Field
                                    as="textarea"
                                    name="symptoms"
                                    className="mt-1 w-full p-3 border rounded-md h-32 focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_symptoms')}
                                />
                                <ErrorMessage name="symptoms" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="bg-blue-600 text-white p-3 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                            >
                                {isSubmitting ? t('submitting') : t('analyze_symptoms')}
                            </button>
                        </Form>
                    )}
                </Formik>
                {aiAnalysis && (
                    <div className="mt-4 p-4 bg-gray-100 rounded-md">
                        <h3 className="text-lg font-medium">{t('ai_analysis_result')}</h3>
                        <pre>{JSON.stringify(aiAnalysis, null, 2)}</pre>
                    </div>
                )}
            </div>

            {/* Prescription Fulfillment */}
            <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4 text-blue-600">{t('prescription_management')}</h2>
                <Formik
                    initialValues={{
                        medicationHash: '',
                        dosage: '',
                        refills: 0,
                        duration: 0,
                        ipfsHash: ''
                    }}
                    validationSchema={prescriptionSchema}
                    onSubmit={issuePrescription}
                >
                    {({ isSubmitting }) => (
                        <Form className="space-y-4">
                            <div>
                                <label htmlFor="medicationHash" className="block text-sm font-medium text-gray-700">
                                    {t('medication_hash')}
                                </label>
                                <Field
                                    name="medicationHash"
                                    className="mt-1 w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_medication_hash')}
                                />
                                <ErrorMessage name="medicationHash" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <div>
                                <label htmlFor="dosage" className="block text-sm font-medium text-gray-700">
                                    {t('dosage')}
                                </label>
                                <Field
                                    name="dosage"
                                    className="mt-1 w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_dosage')}
                                />
                                <ErrorMessage name="dosage" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <div>
                                <label htmlFor="refills" className="block text-sm font-medium text-gray-700">
                                    {t('refills')}
                                </label>
                                <Field
                                    name="refills"
                                    type="number"
                                    className="mt-1 w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_refills')}
                                />
                                <ErrorMessage name="refills" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <div>
                                <label htmlFor="duration" className="block text-sm font-medium text-gray-700">
                                    {t('duration')}
                                </label>
                                <Field
                                    name="duration"
                                    type="number"
                                    className="mt-1 w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_duration_days')}
                                />
                                <ErrorMessage name="duration" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <div>
                                <label htmlFor="ipfsHash" className="block text-sm font-medium text-gray-700">
                                    {t('ipfs_hash')}
                                </label>
                                <Field
                                    name="ipfsHash"
                                    className="mt-1 w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder={t('enter_ipfs_hash')}
                                />
                                <ErrorMessage name="ipfsHash" component="p" className="mt-1 text-red-500 text-sm" />
                            </div>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="bg-green-600 text-white p-3 rounded-md hover:bg-green-700 disabled:bg-gray-400"
                            >
                                {isSubmitting ? t('submitting') : t('issue_prescription')}
                            </button>
                        </Form>
                    )}
                </Formik>

                <div className="mt-6">
                    <h3 className="text-xl font-medium mb-2">{t('your_prescriptions')}</h3>
                    {prescriptions.length > 0 ? (
                        <ul className="space-y-4">
                            {prescriptions.map((prescription, index) => (
                                <li key={index} className="p-4 bg-white rounded-md shadow">
                                    <p><strong>{t('prescription_id')}:</strong> {prescription.prescriptionId}</p>
                                    <p><strong>{t('medication_hash')}:</strong> {prescription.medicationHash}</p>
                                    <p><strong>{t('dosage')}:</strong> {prescription.dosageInstructions}</p>
                                    <p><strong>{t('remaining_refills')}:</strong> {prescription.remainingRefills}</p>
                                    <p><strong>{t('status')}:</strong> {prescription.status}</p>
                                    {prescription.remainingRefills > 0 && (
                                        <button
                                            onClick={() => refillPrescription(prescription.prescriptionId)}
                                            className="mt-2 bg-purple-600 text-white p-2 rounded-md hover:bg-purple-700"
                                        >
                                            {t('refill')}
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>{t('no_prescriptions')}</p>
                    )}
                </div>
            </div>

            {/* Data Monetization */}
            <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4 text-blue-600">{t('data_monetization')}</h2>
                <button
                    onClick={monetizeData}
                    className="bg-orange-600 text-white p-3 rounded-md hover:bg-orange-700"
                >
                    {t('monetize_data')}
                </button>
            </div>

            {error && <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
        </div>
    );
};

export default AISymptomAnalysis;
