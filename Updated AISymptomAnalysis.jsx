import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { setDraft, setPreview } from './slices/aiSlice';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Web3 from 'web3';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, PointElement, LinearScale, Title, CategoryScale } from 'chart.js';
import moment from 'moment';

ChartJS.register(LineElement, PointElement, LinearScale, Title, CategoryScale);

const AISymptomAnalysis = ({ account, signer, token, isDoctor }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { draft, preview, loading, error } = useSelector((state) => state.ai);
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [prescriptions, setPrescriptions] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [mediPoints, setMediPoints] = useState(0);
  const [appointments, setAppointments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const web3 = new Web3(process.env.REACT_APP_NETWORK_URL);

  const symptomSchema = Yup.object({
    patientAddress: Yup.string().matches(/^0x[a-fA-F0-9]{40}$/, t('invalid_address')).required(t('patient_address_required')),
    symptoms: Yup.string().max(1000, t('symptoms_max_length')).required(t('symptoms_required')),
  });

  const prescriptionSchema = Yup.object({
    medicationHash: Yup.string().matches(/^0x[a-fA-F0-9]{64}$/, t('invalid_hash')).required(t('medication_hash_required')),
    dosage: Yup.string().max(100, t('dosage_max_length')).required(t('dosage_required')),
    refills: Yup.number().min(0, t('refills_min')).max(10, t('refills_max')).required(t('refills_required')),
    duration: Yup.number().min(1, t('duration_min')).required(t('duration_required')),
    ipfsHash: Yup.string().max(128, t('ipfs_hash_max_length')).required(t('ipfs_hash_required')),
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
      } else if (data.type === 'appointmentStatus') {
        setAppointments(prev => prev.map(apt => apt.appointmentId === data.data[0] ? data.data : apt));
      }
    };
    fetchPrescriptions();
    fetchMediPoints();
    fetchAppointments();
    fetchAnalytics();
    return () => ws.current.close();
  }, [dispatch, t]);

  const fetchPrescriptions = async () => {/* unchanged */};
  const fetchMediPoints = async () => {/* unchanged */};
  const analyzeSymptoms = async (values) => {/* unchanged */};
  const issuePrescription = async (values) => {/* unchanged */};
  const refillPrescription = async (prescriptionId) => {/* unchanged */};
  const monetizeData = async () => {/* unchanged */};

  const fetchAppointments = async () => {
    try {
      const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/patient-appointments/${account}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAppointments(data.appointments);
    } catch (error) {
      toast.error(t('fetch_appointments_error'));
    }
  };

  const fetchAnalytics = async () => {
    try {
      const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/patient-analytics/${account}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAnalytics(data.analytics);
    } catch (error) {
      toast.error(t('fetch_analytics_error'));
    }
  };

  const confirmAppointment = async (appointmentId) => {
    try {
      const signature = await signer.signMessage(`Confirm appointment ${appointmentId}`);
      const { data } = await axios.post(`${process.env.REACT_APP_API_URL}/confirm-appointment`, 
        { appointmentId, signature }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('appointment_confirmed'));
      fetchAppointments();
    } catch (error) {
      toast.error(t('confirm_appointment_error'));
    }
  };

  const confirmAIResult = async (appointmentId, aiResultHash) => {
    try {
      const signature = await signer.signMessage(`Confirm AI result for ${appointmentId}`);
      const { data } = await axios.post(`${process.env.REACT_APP_API_URL}/confirm-ai-result`, 
        { appointmentId, aiResultHash, signature }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('ai_result_confirmed'));
    } catch (error) {
      toast.error(t('confirm_ai_result_error'));
    }
  };

  const chartData = aiAnalysis ? {
    labels: ['Time'],
    datasets: [{ label: 'Diagnosis Confidence', data: [aiAnalysis.confidence || 0], borderColor: 'rgba(75, 192, 192, 1)', tension: 0.1 }]
  } : null;

  return (
    <div className="container mx-auto p-6 bg-gray-50 rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold mb-6 text-blue-600">{t('telemedicine_dashboard')}</h1>
      <div className="mb-4 flex items-center">
        <span className={`h-3 w-3 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
        <span>{isConnected ? t('connected') : t('disconnected')}</span>
        <span className="ml-4">MediPoints: {mediPoints}</span>
      </div>

      {/* AI Symptom Analysis */}
      <div className="mb-8">{/* unchanged */}</div>

      {/* Prescription Fulfillment */}
      {isDoctor && <div className="mb-8">{/* unchanged */}</div>}

      {/* Appointments */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-blue-600">{t('appointments')}</h2>
        {appointments.length > 0 ? (
          <ul className="space-y-4">
            {appointments.map((apt, index) => (
              <li key={index} className="p-4 bg-white rounded-md shadow">
                <p><strong>{t('appointment_id')}:</strong> {apt[0]}</p>
                <p><strong>{t('scheduled')}:</strong> {moment.unix(apt[1]).format('LLL')}</p>
                <p><strong>{t('status')}:</strong> {['Pending', 'Confirmed', 'Completed', 'Cancelled', 'Emergency'][apt[3]]}</p>
                {isDoctor && apt[3] === 0 && (
                  <button onClick={() => confirmAppointment(apt[0])} className="mt-2 bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700">
                    {t('confirm_appointment')}
                  </button>
                )}
                {isDoctor && aiAnalysis && (apt[3] === 1 || apt[3] === 4) && (
                  <button onClick={() => confirmAIResult(apt[0], aiAnalysis.ipfsHash)} className="mt-2 bg-green-600 text-white p-2 rounded-md hover:bg-green-700">
                    {t('confirm_ai_result')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : <p>{t('no_appointments')}</p>}
      </div>

      {/* Patient Analytics Dashboard */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-blue-600">{t('analytics_dashboard')}</h2>
        {analytics ? (
          <div className="p-4 bg-white rounded-md shadow">
            <p><strong>{t('medi_points')}:</strong> {analytics.mediPoints}</p>
            <p><strong>{t('monthly_appointments')}:</strong> {analytics.appointmentCount}</p>
            <p><strong>{t('prescription_count')}:</strong> {analytics.prescriptionCount}</p>
            <p><strong>{t('data_monetized')}:</strong> {analytics.dataMonetized ? t('yes') : t('no')}</p>
          </div>
        ) : <p>{t('loading_analytics')}</p>}
      </div>

      {/* Data Monetization */}
      <div className="mb-8">{/* unchanged */}</div>

      {error && <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
    </div>
  );
};

export default AISymptomAnalysis;
